import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var root = ""
    var token = ""
    var baseURL = "http://127.0.0.1:8766"
    var started = false
    var attempts = 0
    // Bootstrap must not inherit an old tm_session from URLSession.shared.
    // Cookie-bearing browser writes require Origin; the launcher uses its token.
    let launcherSession = URLSession(configuration: .ephemeral)

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu=NSMenu();let main=NSMenuItem();menu.addItem(main)
        let appMenu=NSMenu();main.submenu=appMenu
        appMenu.addItem(withTitle:"TradingManager 종료",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        let edit=NSMenuItem(title:"편집",action:nil,keyEquivalent:"");menu.addItem(edit)
        let editMenu=NSMenu(title:"편집");edit.submenu=editMenu
        for (name,action,key) in [("복사","copy:","c"),("붙여넣기","paste:","v"),("전체 선택","selectAll:","a")] {editMenu.addItem(withTitle:name,action:Selector(action),keyEquivalent:key)}
        NSApp.mainMenu=menu
        window=NSWindow(contentRect:NSRect(x:0,y:0,width:1440,height:920),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.title="TradingManager";window.minSize=NSSize(width:980,height:640);window.center()
        web=WKWebView(frame:window.contentView!.bounds);web.autoresizingMask=[.width,.height];web.navigationDelegate=self
        window.contentView=web;window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
        guard let path=Bundle.main.path(forResource:"LocalConfig",ofType:"json"),let data=try? Data(contentsOf:URL(fileURLWithPath:path)),let config=(try? JSONSerialization.jsonObject(with:data)) as? [String:String],let project=config["root"] else {fail("프로그램 설치 경로를 확인할 수 없습니다.");return}
        root=project
        if let configured=config["url"], let url=URL(string:configured), url.scheme=="http", url.host=="127.0.0.1", url.port != nil {baseURL=configured}
        guard let source=try? String(contentsOfFile:root+"/web/.env.local",encoding:.utf8) else {fail("설정 파일이 없습니다. 설치 프로그램을 먼저 실행해 주세요.");return}
        for line in source.components(separatedBy:.newlines) where line.hasPrefix("TM26_LOCAL_TOKEN=") {
            let value=String(line.dropFirst("TM26_LOCAL_TOKEN=".count))
            if let d=value.data(using:.utf8),let parsed=try? JSONSerialization.jsonObject(with:d,options:.fragmentsAllowed) as? String {token=parsed}
        }
        guard token.count>=32 else {fail("로컬 인증 설정이 없습니다.");return}
        web.loadHTMLString("<html><body style='background:#101318;color:#dce4ef;font:16px -apple-system;padding:60px'><h1>TradingManager</h1><p>로컬 프로그램을 시작하고 있습니다…</p></body></html>",baseURL:nil)
        DispatchQueue.global().async {
            let process=Process();process.executableURL=URL(fileURLWithPath:"/bin/bash");process.arguments=[self.root+"/desktop/start.sh"]
            let log=URL(fileURLWithPath:self.root+"/logs/launcher.log")
            FileManager.default.createFile(atPath:log.path,contents:nil)
            if let handle=try? FileHandle(forWritingTo:log){process.standardOutput=handle;process.standardError=handle}
            do{try process.run();process.waitUntilExit();DispatchQueue.main.async{if process.terminationStatus==0{self.poll()}else{self.fail("시작하지 못했습니다. logs/launcher.log를 확인해 주세요.")}}}
            catch{DispatchQueue.main.async{self.fail("시작 도구를 실행하지 못했습니다.")}}
        }
    }
    func poll(){
        attempts+=1
        launcherSession.dataTask(with:URL(string:self.baseURL+"/api/local/status")!){data,response,error in
            DispatchQueue.main.async {
                if let response=response as? HTTPURLResponse,response.statusCode==200 {
                    var request=URLRequest(url:URL(string:self.baseURL+"/api/local/session")!)
                    request.httpMethod="POST";request.setValue(self.token,forHTTPHeaderField:"x-local-launch-token")
                    request.httpShouldHandleCookies=false
                    self.launcherSession.dataTask(with:request){data,response,error in
                        guard let response=response as? HTTPURLResponse,response.statusCode==200,
                              let url=response.url else {DispatchQueue.main.async{self.fail("로컬 인증에 실패했습니다.")};return}
                        let headers=response.allHeaderFields.reduce(into:[String:String]()){result,item in result[String(describing:item.key)]=String(describing:item.value)}
                        let cookies=HTTPCookie.cookies(withResponseHeaderFields:headers,for:url)
                        guard cookies.contains(where:{$0.name=="tm_session"}) else {DispatchQueue.main.async{self.fail("로컬 로그인 쿠키를 받지 못했습니다.")};return}
                        DispatchQueue.main.async{
                            let group=DispatchGroup()
                            for cookie in cookies{group.enter();self.web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie){group.leave()}}
                            group.notify(queue:.main){self.started=true;self.web.load(URLRequest(url:URL(string:self.baseURL+"/#terminal/overview")!))}
                        }
                    }.resume()
                }else if self.attempts<90{DispatchQueue.main.asyncAfter(deadline:.now()+1){self.poll()}}
                else{self.fail("로컬 데이터베이스에 연결할 수 없습니다. logs 폴더를 확인해 주세요.")}
            }
        }.resume()
    }
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){
        if webView.url?.path=="/api/local/session" && !started {started=true;webView.load(URLRequest(url:URL(string:self.baseURL+"/#terminal/overview")!))}
    }
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
        guard let url=navigationAction.request.url else{decisionHandler(.cancel);return}
        if ["about","data","blob"].contains(url.scheme ?? "") || (url.host=="127.0.0.1" && url.port==URL(string:baseURL)?.port){decisionHandler(.allow);return}
        if navigationAction.navigationType == .linkActivated && ["https","http","mailto"].contains(url.scheme ?? ""){NSWorkspace.shared.open(url)}
        decisionHandler(.cancel)
    }
    func fail(_ message:String){let alert=NSAlert();alert.messageText="TradingManager 시작 확인";alert.informativeText=message;alert.runModal()}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{return true}
}
let app=NSApplication.shared
let delegate=AppDelegate();app.delegate=delegate;app.setActivationPolicy(.regular);app.run()
