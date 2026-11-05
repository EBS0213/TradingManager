import json,pathlib,plistlib,subprocess,shutil,sys
root=pathlib.Path(__file__).resolve().parent.parent
target=root/'desktop/dist/TradingManager.app'
contents=target/'Contents';(contents/'MacOS').mkdir(parents=True,exist_ok=True);(contents/'Resources').mkdir(exist_ok=True)
cache=root/'desktop/.build';cache.mkdir(exist_ok=True)
subprocess.run(['xcrun','swiftc',str(root/'desktop/TM26.swift'),'-O','-module-cache-path',str(cache),'-framework','Cocoa','-framework','WebKit','-o',str(contents/'MacOS/TM26')],check=True)
plist={'CFBundleName':'TradingManager','CFBundleDisplayName':'TradingManager','CFBundleExecutable':'TM26','CFBundleIdentifier':'com.tm26.local','CFBundleShortVersionString':'1.0.0','CFBundleVersion':'1','CFBundlePackageType':'APPL','CFBundleIconFile':'AppIcon','NSHighResolutionCapable':True,'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True},'LSMinimumSystemVersion':'13.0'}
(contents/'Info.plist').write_bytes(plistlib.dumps(plist))
(contents/'Resources/LocalConfig.json').write_text(json.dumps({'root':str(root)}))
icon=root/'desktop/AppIcon.icns'
if icon.exists():shutil.copy2(icon,contents/'Resources/AppIcon.icns')
subprocess.run(['codesign','--force','--deep','--sign','-',str(target)],check=True)
print(target)
