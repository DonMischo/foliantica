# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Foliantica FastAPI backend.
Run from the api/ directory:
    pyinstaller foliantica.spec
"""

import sys
from pathlib import Path

block_cipher = None

a = Analysis(
    ["run.py"],
    pathex=["."],
    binaries=[],
    datas=[
        # Include the templates directory used by the export router
        ("templates", "templates"),
        # Alembic reads these from disk at runtime (script_location), not via
        # Python import, so PyInstaller's static analysis never picks them up
        # on its own.
        ("alembic.ini", "."),
        ("alembic", "alembic"),
        # RPG ruleset read from disk by services/dm_chargen.py
        ("data", "data"),
    ],
    hiddenimports=[
        # uvicorn internals that PyInstaller misses
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.http.httptools_impl",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.logging",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        # SQLAlchemy SQLite dialect
        "sqlalchemy.dialects.sqlite",
        "sqlalchemy.sql.default_comparator",
        # anyio backend
        "anyio._backends._asyncio",
        # cryptography / cffi
        "cryptography.hazmat.bindings._rust",
        "cryptography.hazmat.primitives.serialization",
        "cffi",
        "_cffi_backend",
        # email (used by some httpx/starlette internals)
        "email.mime.text",
        "email.mime.multipart",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "test", "unittest"],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="foliantica-api",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,          # UPX can break cryptography binaries
    console=False,      # No terminal window for end-users
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# onedir mode: faster startup (no extraction step), all files in one folder
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="foliantica-api",
)
