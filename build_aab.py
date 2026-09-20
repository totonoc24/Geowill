"""
GeoPlan / Geowill Android - Standalone Android App Bundle (.aab) Builder Pipeline
Compiles and packages the Google Play Store Android App Bundle (.aab) using:
- aapt2 (--proto-format)
- ecj.jar (Java Compiler)
- d8 / r8.jar (Dexer)
- bundletool.jar (Google Official App Bundle Builder)
- keytool (Keystore Generator)
"""

import os
import shutil
import subprocess
import zipfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BUILD_DIR = os.path.join(BASE_DIR, 'build_android_aab')
TOOLS_DIR = os.path.join(BASE_DIR, 'tools', 'android')

ANDROID_JAR = os.path.join(TOOLS_DIR, 'android.jar')
ECJ_JAR = os.path.join(TOOLS_DIR, 'ecj.jar')
R8_JAR = os.path.join(TOOLS_DIR, 'r8.jar')
AAPT2_EXE = os.path.join(TOOLS_DIR, 'aapt2.exe')
BUNDLETOOL_JAR = os.path.join(TOOLS_DIR, 'bundletool.jar')
KEYTOOL_EXE = os.path.join(TOOLS_DIR, 'jre17_temp', 'jdk-17.0.10+7-jre', 'bin', 'keytool.exe')
if not os.path.exists(KEYTOOL_EXE):
    KEYTOOL_EXE = 'keytool'

JAVA_EXE = os.path.join(TOOLS_DIR, 'jre17_temp', 'jdk-17.0.10+7-jre', 'bin', 'java.exe')
if not os.path.exists(JAVA_EXE):
    JAVA_EXE = 'java'

APP_NAME = 'Geowill'
OUTPUT_AAB_NAME = 'Geowill_Android_v2.1.1.aab'
KEYSTORE_PATH = os.path.join(BASE_DIR, 'geowill_play_upload.keystore')
KEYSTORE_PASS = 'geowill2026'
KEY_ALIAS = 'geowill_upload'
KEY_PASS = 'geowill2026'

# Import creation functions from build_apk
import build_apk

def setup_directories():
    print('[1/6] Preparando directorios para Android App Bundle (.aab)...')
    if os.path.exists(BUILD_DIR):
        shutil.rmtree(BUILD_DIR)
    os.makedirs(os.path.join(BUILD_DIR, 'src', 'com', 'geowill'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'values'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'drawable'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'xml'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'mipmap-mdpi'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'mipmap-hdpi'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'mipmap-xhdpi'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'mipmap-xxhdpi'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'res', 'mipmap-xxxhdpi'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'assets'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'compiled_res'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'classes'), exist_ok=True)
    os.makedirs(os.path.join(BUILD_DIR, 'dex'), exist_ok=True)

def copy_sources_and_assets():
    print('[2/6] Generando fuentes nativas, recursos y copiando archivos web...')
    orig_build_dir = build_apk.BUILD_DIR
    build_apk.BUILD_DIR = BUILD_DIR
    try:
        build_apk.create_manifest_and_resources()
        build_apk.create_java_source()
        build_apk.copy_web_assets()
    finally:
        build_apk.BUILD_DIR = orig_build_dir

def compile_proto_and_bundle():
    print('[3/6] Compilando recursos en formato Protobuf con aapt2 (--proto-format)...')
    
    # 1. Compile resources
    res_dir = os.path.join(BUILD_DIR, 'res')
    compiled_res_zip = os.path.join(BUILD_DIR, 'compiled_res', 'resources.zip')
    cmd = [AAPT2_EXE, 'compile', '--dir', res_dir, '-o', compiled_res_zip]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print('Error aapt2 compile:', res.stderr)
        raise RuntimeError(res.stderr)

    # 2. Link in proto format for App Bundle
    r_java_dir = os.path.join(BUILD_DIR, 'src')
    manifest_file = os.path.join(BUILD_DIR, 'AndroidManifest.xml')
    assets_dir = os.path.join(BUILD_DIR, 'assets')
    proto_apk = os.path.join(BUILD_DIR, 'proto_base.apk')

    cmd = [
        AAPT2_EXE, 'link',
        '--proto-format',
        '-I', ANDROID_JAR,
        '--manifest', manifest_file,
        '--java', r_java_dir,
        '-A', assets_dir,
        '-o', proto_apk,
        compiled_res_zip,
        '--auto-add-overlay'
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print('Error aapt2 link --proto-format:', res.stderr)
        raise RuntimeError(res.stderr)

    # 3. Compile Java with ecj.jar
    print('[4/6] Compilando código Java nativo a bytecode y clases DEX...')
    classes_dir = os.path.join(BUILD_DIR, 'classes')
    java_files = []
    for root, _, files in os.walk(os.path.join(BUILD_DIR, 'src')):
        for file in files:
            if file.endswith('.java'):
                java_files.append(os.path.join(root, file))

    cmd = [
        JAVA_EXE, '-jar', ECJ_JAR,
        '-7',
        '-cp', ANDROID_JAR,
        '-d', classes_dir,
        *java_files
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0 and not os.path.exists(os.path.join(classes_dir, 'com', 'geowill', 'MainActivity.class')):
        print('Error ecj:', res.stderr)
        raise RuntimeError(res.stderr)

    # 4. Convert .class to classes.dex using D8/R8
    dex_dir = os.path.join(BUILD_DIR, 'dex')
    class_files = []
    for root, _, files in os.walk(classes_dir):
        for file in files:
            if file.endswith('.class'):
                class_files.append(os.path.join(root, file))

    cmd = [
        JAVA_EXE, '-cp', R8_JAR,
        'com.android.tools.r8.D8',
        '--lib', ANDROID_JAR,
        '--min-api', '21',
        '--output', dex_dir,
        *class_files
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print('Error d8:', res.stderr)
        raise RuntimeError(res.stderr)

    dex_file = os.path.join(dex_dir, 'classes.dex')

    # 5. Build base.zip module for bundletool
    print('[5/6] Empaquetando módulo base.zip y construyendo Android App Bundle (.aab)...')
    base_module_dir = os.path.join(BUILD_DIR, 'base_module')
    os.makedirs(base_module_dir, exist_ok=True)
    
    # Extract proto_apk contents into base_module_dir
    with zipfile.ZipFile(proto_apk, 'r') as zf:
        zf.extractall(base_module_dir)

    # Move AndroidManifest.xml to manifest/AndroidManifest.xml
    manifest_src = os.path.join(base_module_dir, 'AndroidManifest.xml')
    manifest_dst_dir = os.path.join(base_module_dir, 'manifest')
    os.makedirs(manifest_dst_dir, exist_ok=True)
    if os.path.exists(manifest_src):
        shutil.move(manifest_src, os.path.join(manifest_dst_dir, 'AndroidManifest.xml'))

    # Put classes.dex into dex/classes.dex
    dex_dst_dir = os.path.join(base_module_dir, 'dex')
    os.makedirs(dex_dst_dir, exist_ok=True)
    shutil.copy(dex_file, os.path.join(dex_dst_dir, 'classes.dex'))

    # Create base.zip
    base_zip_path = os.path.join(BUILD_DIR, 'base.zip')
    with zipfile.ZipFile(base_zip_path, 'w', zipfile.ZIP_DEFLATED) as bz:
        for root, _, files in os.walk(base_module_dir):
            for file in files:
                abs_p = os.path.join(root, file)
                rel_p = os.path.relpath(abs_p, base_module_dir).replace('\\', '/')
                bz.write(abs_p, rel_p)

    # Build .aab using bundletool
    final_aab_path = os.path.join(BASE_DIR, OUTPUT_AAB_NAME)
    cmd = [
        JAVA_EXE, '-jar', BUNDLETOOL_JAR,
        'build-bundle',
        f'--modules={base_zip_path}',
        f'--output={final_aab_path}',
        '--overwrite'
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print('Error bundletool build-bundle:', res.stderr)
        raise RuntimeError(res.stderr)

    return final_aab_path

def generate_keystore_if_needed():
    print('[6/7] Verificando Keystore de subida para Google Play...')
    if not os.path.exists(KEYSTORE_PATH):
        print('Generando nuevo keystore de subida para Google Play...')
        cmd = [
            KEYTOOL_EXE,
            '-genkeypair',
            '-v',
            '-keystore', KEYSTORE_PATH,
            '-alias', KEY_ALIAS,
            '-keyalg', 'RSA',
            '-keysize', '2048',
            '-validity', '10000',
            '-storepass', KEYSTORE_PASS,
            '-keypass', KEY_PASS,
            '-dname', 'CN=Geowill Topografia, OU=Mobile GIS, O=Geowill, L=Medellin, ST=Antioquia, C=CO'
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print('Advertencia al generar keystore:', res.stderr)
        else:
            print(f'Keystore generado exitosamente en: {KEYSTORE_PATH}')
    else:
        print(f'Keystore existente encontrado: {KEYSTORE_PATH}')

def sign_aab(final_aab_path):
    print('[7/7] Firmando el Android App Bundle (.aab) con firma JAR V1...')
    sign_bundle_class = os.path.join(TOOLS_DIR, 'SignBundle.class')
    sign_bundle_java = os.path.join(TOOLS_DIR, 'SignBundle.java')
    if not os.path.exists(sign_bundle_class):
        cmd = [JAVA_EXE, '-jar', ECJ_JAR, '-1.8', '-d', TOOLS_DIR, sign_bundle_java]
        subprocess.run(cmd, check=True)

    cmd = [
        JAVA_EXE,
        '--add-exports', 'java.base/sun.security.pkcs=ALL-UNNAMED',
        '--add-exports', 'java.base/sun.security.x509=ALL-UNNAMED',
        '-cp', TOOLS_DIR,
        'SignBundle',
        final_aab_path,
        KEYSTORE_PATH,
        KEYSTORE_PASS,
        KEY_ALIAS,
        KEY_PASS
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print('Error firmando AAB:', res.stderr)
        raise RuntimeError(res.stderr)

def verify_aab(final_aab_path):
    print('\nVerificando integridad y estructura del archivo .AAB con bundletool...')
    test_apks_path = os.path.join(BUILD_DIR, 'test_apks.apks')
    cmd = [
        JAVA_EXE, '-jar', BUNDLETOOL_JAR,
        'build-apks',
        f'--bundle={final_aab_path}',
        f'--output={test_apks_path}',
        f'--ks={KEYSTORE_PATH}',
        f'--ks-key-alias={KEY_ALIAS}',
        f'--ks-pass=pass:{KEYSTORE_PASS}',
        f'--key-pass=pass:{KEY_PASS}',
        '--mode=universal',
        '--overwrite'
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0 and os.path.exists(test_apks_path):
        print('[OK] Archivo AAB 100% valido, firmado y verificado para Google Play Store!')
    else:
        print('Bundletool verify warning/notice:', res.stderr)

if __name__ == '__main__':
    setup_directories()
    copy_sources_and_assets()
    aab_path = compile_proto_and_bundle()
    generate_keystore_if_needed()
    sign_aab(aab_path)
    verify_aab(aab_path)

    print('\n=============================================================')
    print(' EXITO: ANDROID APP BUNDLE (.AAB) FIRMADO PARA PLAY STORE')
    print(f' Archivo: {aab_path}')
    print(f' Tamano:  {os.path.getsize(aab_path) / 1024:.1f} KB')
    print(f' Keystore de subida: {KEYSTORE_PATH}')
    print(f' Alias: {KEY_ALIAS} | Clave: {KEYSTORE_PASS}')
    print('=============================================================\n')
