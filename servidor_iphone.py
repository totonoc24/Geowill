import os
import sys
import socket
import ssl
from http.server import HTTPServer, SimpleHTTPRequestHandler
import datetime
import subprocess

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

def generate_self_signed_cert(cert_file='cert.pem', key_file='key.pem'):
    if os.path.exists(cert_file) and os.path.exists(key_file):
        return True
    try:
        # Try generating via powershell or openssl
        cmd = [
            'powershell', '-Command',
            f"$cert = New-SelfSignedCertificate -DnsName 'localhost', '{get_local_ip()}' -CertStoreLocation 'cert:\\LocalMachine\\My'; "
            f"Write-Host $cert.Thumbprint"
        ]
        # Or simple ad-hoc generation with python if cryptography is installed
        try:
            from cryptography import x509
            from cryptography.x509.oid import NameOID
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import rsa

            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            subject = issuer = x509.Name([
                x509.NameAttribute(NameOID.COUNTRY_NAME, "CO"),
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Geowill GIS"),
                x509.NameAttribute(NameOID.COMMON_NAME, get_local_ip()),
            ])
            cert = x509.CertificateBuilder().subject_name(
                subject
            ).issuer_name(
                issuer
            ).public_key(
                key.public_key()
            ).serial_number(
                x509.random_serial_number()
            ).not_valid_before(
                datetime.datetime.utcnow()
            ).not_valid_after(
                datetime.datetime.utcnow() + datetime.timedelta(days=365)
            ).sign(key, hashes.SHA256())

            with open(key_file, "wb") as f:
                f.write(key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.TraditionalOpenSSL,
                    encryption_algorithm=serialization.NoEncryption()
                ))
            with open(cert_file, "wb") as f:
                f.write(cert.public_bytes(serialization.Encoding.PEM))
            return True
        except ImportError:
            return False
    except Exception:
        return False

def main():
    ip = get_local_ip()
    port_http = 8080
    port_https = 8443

    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    has_ssl = generate_self_signed_cert()

    print("=" * 65)
    print("      🚀 GEOWILL - SERVIDOR PARA IPHONE (iOS) & PC")
    print("=" * 65)
    print(f"\n📱 PASOS PARA INSTALAR EN TU IPHONE:")
    print("-----------------------------------------------------------------")
    print(f" 1. Conecta tu iPhone a la misma red Wi-Fi que esta computadora.")
    print(f" 2. Abre el navegador SAFARI en tu iPhone.")
    if has_ssl:
        print(f" 3. Ingresa a la siguiente direccion:")
        print(f"    👉  https://{ip}:{port_https}")
        print(f"    (o http://{ip}:{port_http})")
        print(f"    *Si Safari muestra advertencia de certificado, toca:")
        print(f"     'Mostrar detalles' -> 'Visitar este sitio web'.")
    else:
        print(f" 3. Ingresa a la siguiente direccion:")
        print(f"    👉  http://{ip}:{port_http}")
    print(f" 4. En Safari, toca el boton COMPARTIR (el icono [⎋] en la barra inferior).")
    print(f" 5. Selecciona la opcion 'Agregar a inicio' (Add to Home Screen) 📲.")
    print(f" 6. Toca 'Agregar' arriba a la derecha.")
    print(f" 7. ¡Listo! Se abrira Geowill con su icono como App nativa en tu iPhone.")
    print("-----------------------------------------------------------------\n")
    print(f"🖥️  En tu computadora puedes abrir: http://localhost:{port_http}\n")
    print("Presiona Ctrl + C en cualquier momento para detener el servidor.\n")

    handler = SimpleHTTPRequestHandler
    handler.extensions_map.update({
        '.kml': 'application/vnd.google-earth.kml+xml',
        '.kmz': 'application/vnd.google-earth.kmz',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
    })

    if has_ssl and os.path.exists('cert.pem') and os.path.exists('key.pem'):
        httpd = HTTPServer(('0.0.0.0', port_https), handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile='cert.pem', keyfile='key.pem')
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
        print(f"🟢 Servidor HTTPS activo en https://{ip}:{port_https}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")
    else:
        httpd = HTTPServer(('0.0.0.0', port_http), handler)
        print(f"🟢 Servidor HTTP activo en http://{ip}:{port_http}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")

if __name__ == '__main__':
    main()
