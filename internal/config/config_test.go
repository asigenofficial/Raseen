package config

import "testing"

func TestPublicHostRejectsDefaultAdminPassword(t *testing.T) {
	for _, host := range []string{"0.0.0.0", "::", "192.0.2.1"} {
		c := &Config{Host: host, BootstrapAdmin: AdminCredentials{Password: defaultAdminPassword}}
		if err := c.ValidatePublicAdminPassword(); err == nil {
			t.Errorf("%s accepted default admin password", host)
		}
		c.BootstrapAdmin.Password = "a-unique-secret"
		if err := c.ValidatePublicAdminPassword(); err != nil {
			t.Errorf("%s rejected custom password: %v", host, err)
		}
	}
	c := &Config{Host: "127.0.0.1", BootstrapAdmin: AdminCredentials{Password: defaultAdminPassword}}
	if err := c.ValidatePublicAdminPassword(); err != nil {
		t.Fatal(err)
	}
}
