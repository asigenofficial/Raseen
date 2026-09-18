package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/crypto/pbkdf2"
)

const (
	Pbkdf2Iter   = 210000
	Pbkdf2KeyLen = 64
)

// UUID generates a standard v4 UUID string.
func UUID() string {
	return uuid.New().String()
}

// Token generates a base64url random token.
func Token(byteLen int) string {
	if byteLen <= 0 {
		byteLen = 32
	}
	b := make([]byte, byteLen)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// FormatSerial formats a serial prefix and number (e.g. "INV-00123").
func FormatSerial(prefix string, number int64, width int) string {
	format := fmt.Sprintf("%%0%dd", width)
	numStr := fmt.Sprintf(format, number)
	if prefix != "" {
		return fmt.Sprintf("%s-%s", prefix, numStr)
	}
	return numStr
}

// HashPassword hashes a password using PBKDF2-HMAC-SHA512 (210,000 iterations).
func HashPassword(password, salt string) (hashed string, usedSalt string) {
	if salt == "" {
		saltBytes := make([]byte, 16)
		_, _ = rand.Read(saltBytes)
		salt = hex.EncodeToString(saltBytes)
	}
	dk := pbkdf2.Key([]byte(password), []byte(salt), Pbkdf2Iter, Pbkdf2KeyLen, sha512.New)
	return hex.EncodeToString(dk), salt
}

// VerifyPassword securely checks if a plaintext password matches salt and expected hash.
func VerifyPassword(password, salt, expectedHash string) bool {
	if salt == "" || expectedHash == "" {
		return false
	}
	actualHash, _ := HashPassword(password, salt)
	a, err1 := hex.DecodeString(actualHash)
	b, err2 := hex.DecodeString(expectedHash)
	if err1 != nil || err2 != nil || len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare(a, b) == 1
}

var cachedMasterKey []byte

// GetMasterKey loads or creates a 32-byte AES-GCM master key.
func GetMasterKey(keyFilePath string) ([]byte, error) {
	if len(cachedMasterKey) == 32 {
		return cachedMasterKey, nil
	}

	if err := os.MkdirAll(filepath.Dir(keyFilePath), 0755); err != nil {
		return nil, err
	}

	if data, err := os.ReadFile(keyFilePath); err == nil {
		key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(data)))
		if err == nil && len(key) == 32 {
			cachedMasterKey = key
			return key, nil
		}
	}

	newKey := make([]byte, 32)
	if _, err := rand.Read(newKey); err != nil {
		return nil, err
	}
	b64Key := base64.StdEncoding.EncodeToString(newKey)
	if err := os.WriteFile(keyFilePath, []byte(b64Key), 0600); err != nil {
		return nil, err
	}

	cachedMasterKey = newKey
	return newKey, nil
}

// EncryptSecret encrypts plaintext to "v1:iv:tag:ciphertext" in Base64 using AES-256-GCM.
func EncryptSecret(plain string, masterKey []byte) (string, error) {
	if plain == "" {
		return "", nil
	}
	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return "", err
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, aesgcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}

	sealed := aesgcm.Seal(nil, nonce, []byte(plain), nil)
	tagSize := 16
	cipherText := sealed[:len(sealed)-tagSize]
	tag := sealed[len(sealed)-tagSize:]

	return fmt.Sprintf("v1:%s:%s:%s",
		base64.StdEncoding.EncodeToString(nonce),
		base64.StdEncoding.EncodeToString(tag),
		base64.StdEncoding.EncodeToString(cipherText),
	), nil
}

// DecryptSecret decrypts a "v1:iv:tag:ciphertext" payload.
func DecryptSecret(payload string, masterKey []byte) (string, error) {
	if payload == "" {
		return "", nil
	}
	parts := strings.Split(payload, ":")
	if len(parts) != 4 || parts[0] != "v1" {
		return "", errors.New("invalid secret payload format")
	}

	nonce, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	tag, err := base64.StdEncoding.DecodeString(parts[2])
	if err != nil {
		return "", err
	}
	cipherText, err := base64.StdEncoding.DecodeString(parts[3])
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return "", err
	}
	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	sealed := append(cipherText, tag...)
	plain, err := aesgcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", err
	}

	return string(plain), nil
}

func Sha256Base64(input []byte) string {
	h := sha256.Sum256(input)
	return base64.StdEncoding.EncodeToString(h[:])
}

func Sha256Hex(input []byte) string {
	h := sha256.Sum256(input)
	return hex.EncodeToString(h[:])
}

func MaskSecret(val string) string {
	if val == "" {
		return ""
	}
	if len(val) <= 8 {
		return "••••••••"
	}
	return fmt.Sprintf("%s••••%s", val[:4], val[len(val)-4:])
}
