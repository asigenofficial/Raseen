package crypto

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetMasterKeyRejectsCorruptExistingFile(t *testing.T) {
	cachedMasterKey = nil
	t.Cleanup(func() { cachedMasterKey = nil })
	path := filepath.Join(t.TempDir(), "secret.key")
	if err := os.WriteFile(path, []byte("not-a-valid-key"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := GetMasterKey(path); err == nil {
		t.Fatal("corrupt key was silently replaced")
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "not-a-valid-key" {
		t.Fatalf("original key changed: %q, %v", data, err)
	}
}

func TestGetMasterKeyCreatesAndReloads(t *testing.T) {
	cachedMasterKey = nil
	t.Cleanup(func() { cachedMasterKey = nil })
	path := filepath.Join(t.TempDir(), "secret.key")
	first, err := GetMasterKey(path)
	if err != nil || len(first) != 32 {
		t.Fatalf("create key: length=%d err=%v", len(first), err)
	}
	cachedMasterKey = nil
	second, err := GetMasterKey(path)
	if err != nil || string(first) != string(second) {
		t.Fatalf("reload key: err=%v", err)
	}
}
