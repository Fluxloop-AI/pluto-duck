# -*- mode: python ; coding: utf-8 -*-
import os
import pathlib

import duckdb

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


PROJECT_ROOT = pathlib.Path.cwd()
BACKEND_ROOT = PROJECT_ROOT / "backend" / "pluto_duck_backend"
TEMPLATE_DIR = BACKEND_ROOT / "templates"
STATIC_DIR = BACKEND_ROOT / "app" / "static"
CONFIG_DIR = BACKEND_ROOT / "app" / "core" / "config_templates"
EXTRA_DATA = []

if TEMPLATE_DIR.exists():
    EXTRA_DATA.append((str(TEMPLATE_DIR), "pluto_duck_backend/templates"))

if STATIC_DIR.exists():
    EXTRA_DATA.append((str(STATIC_DIR), "pluto_duck_backend/static"))

if CONFIG_DIR.exists():
    EXTRA_DATA.append((str(CONFIG_DIR), "pluto_duck_backend/config_templates"))

EXTRA_DATA.extend(collect_data_files("pluto_duck_backend", include_py_files=False))
EXTRA_DATA.extend(collect_data_files("duckdb", include_py_files=False))
EXTRA_DATA.extend(collect_data_files("llama_cpp", include_py_files=True))

DUCKDB_DIST_INFO = pathlib.Path(duckdb.__file__).resolve().parent.parent / f"duckdb-{duckdb.__version__}.dist-info"
if DUCKDB_DIST_INFO.exists():
    EXTRA_DATA.append((str(DUCKDB_DIST_INFO), DUCKDB_DIST_INFO.name))


os.environ.setdefault("PLUTODUCK_LOG_LEVEL", "INFO")

hiddenimports = []
hiddenimports += collect_submodules('pluto_duck_backend')
hiddenimports += collect_submodules('llama_cpp')


a = Analysis(
    ['backend/run_backend.py'],
    pathex=[str(PROJECT_ROOT)],
    binaries=[],
    datas=EXTRA_DATA,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='pluto-duck-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='pluto-duck-backend',
)
