# Test-only TLS certificates

Self-signed certificates for `localhost` and `127.0.0.1`, used only by the fake mail server in `../fake-smtp.ts`, so the SMTP client's encrypted paths are tested with certificate checks on. They protect nothing, are never used outside tests, and are not secrets.

- `trusted-*`: the tests tell the client to trust this certificate.
- `untrusted-*`: a second certificate the client does not trust, to prove a bad certificate is refused.

Made on 22 November 2026, valid for 10 years:

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -days 3650 -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout trusted-key.pem -out trusted-cert.pem
```
