import pyotp
import app.twofa as twofa

def test_totp_roundtrip():
    s = twofa.new_secret()
    code = pyotp.TOTP(s).now()
    assert twofa.verify_totp(s, code) is True
    assert twofa.verify_totp(s, "000000") is False

def test_provisioning_uri():
    uri = twofa.provisioning_uri("ABC", "alex")
    assert uri.startswith("otpauth://totp/") and "secret=ABC" in uri and "issuer=" in uri

def test_encrypt_roundtrip():
    enc = twofa.encrypt("topsecret")
    assert enc != "topsecret"
    assert twofa.decrypt(enc) == "topsecret"

def test_email_code_and_hash():
    code = twofa.generate_email_code()
    assert len(code) == 6 and code.isdigit()
    h = twofa.hash_code(code)
    assert h == twofa.hash_code(code) and h != twofa.hash_code("000000")

def test_device_token():
    t = twofa.new_device_token()
    assert len(t) >= 32
    assert twofa.hash_token(t) == twofa.hash_token(t)
    assert twofa.hash_token(t) != twofa.hash_token("x")
