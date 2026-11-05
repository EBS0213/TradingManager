"""Small flock-compatible adapter for process locks on macOS and Windows."""
import os
if os.name != 'nt':
    from fcntl import flock, LOCK_EX, LOCK_NB, LOCK_UN
else:
    import msvcrt
    LOCK_EX, LOCK_NB, LOCK_UN = 2, 4, 8
    def flock(file, operation):
        fd = file if isinstance(file, int) else file.fileno()
        os.lseek(fd, 0, os.SEEK_SET)
        if os.fstat(fd).st_size == 0:
            os.write(fd, b'\0')
            os.lseek(fd, 0, os.SEEK_SET)
        mode = msvcrt.LK_UNLCK if operation & LOCK_UN else (msvcrt.LK_NBLCK if operation & LOCK_NB else msvcrt.LK_LOCK)
        try:
            msvcrt.locking(fd, mode, 1)
        except OSError as error:
            if operation & LOCK_NB:
                raise BlockingIOError('Another process holds this lock') from error
            raise
