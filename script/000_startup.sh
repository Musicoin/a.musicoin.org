#!/bin/bash

if [ ! -f "/musicoin.org/script/100_install.sh" ]
then

echo "Running one-time install..." >> mc_install.log
echo "Setting up ssh config for github access (read-only)..." >> mc_install.log
echo "... writing private key" >> mc_install.log
cat <<EOF > /root/.ssh/github_rsa
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAszFPwaZSgIRQVSLD/uLTxKXkH2wkWJ3pQ+q5+T5Lsib0iBQc
Fz52yB3KKjiH8jzg8HmuggrTGFNAZT7IgLc4IfTCRbzx1QwPmaRuEA6K2l48mzSw
CuA+z30qIa3Zdxp8bzuyleKI04QgdI9/h2Bz2ytwvpOgckQqb6oy/Ex5YSOM3gG/
bJoTDuorhON375JMFEw5qnXkbI1evgSw9RIUSMgDLezcBYcvb4yVEzKB6wKIpno9
WOQijdyS1xUxptNNVe1ulZpxbrW45qCJVclkHH5u3RuXkSIYGdQ3LySQIl4GUewA
iSQJBL6xcSeiIUciXwwty7eUi33zlM03jhQ/pQIDAQABAoIBADYDBRFPusp2F2iy
A/XOFRrPDgXSqNn1LxyDoe7YsiROzaI+vYDcGR2UrR0w0PlZFEwnwUv9S0enwF9E
H1d84nSJvA0dOJ+I9SLQh0Rbvcq4YPg/V1jP4t7T0WE5b7UQzLUSf2/iSm/HAalg
n4YEsqc7Xs5y3QfUOB5UZO3bdzKp7Ot/eXzzq0j447DYPW5eaMFLRfVKt6BnODYF
DoJ4SVE4w8jeDCYY76DGUW8PloI7iQ4Thc4iMaTZ7ktO/NtXXFofLC59jgnafORt
HUsP1Oy9dW0LcwyrwFbWcW0yjOywO3iHqTCt9PCHZfq66LiMtI+xfpYgjR5rdgod
iauotfkCgYEA6ehYFrkOp6E6OvbbiW+PlHadT7rq8svTtOgYDz7NN9I+Dax5cVQL
SyZIWlZxczyqx8BEDNxyqB+wkAsJj8B3EKTdyGBEr8Z+j/Tpfgzfth5kRvHUtkmt
sDdCXC16jSwyAXG++7NP0Wpp+VVaIl2Z2mPNItP2EDP0EhiwDK5ssG8CgYEAxB4D
YImyWLuSLSFn+69QgswafI0Rhz4X3swwOJdqUQ1b/e8dj38BiFsgEexajddLPnR4
9TA3UcAOD1NgdmdhmzLD1TQYJAAtU7lrVsIRkaFIL4G5Y1aOFAezhUWSWJtw72EO
Ldw98eahql62q/aC1nOwsXL8LlSuFVqUmqVbsysCgYEA5WzAoiEHT8IjFFy2/nnP
McaaC+8Brf3gfCu+FY36ycrMlKrcPx05Ko+1He51vpr9w4lA9gBv8ZmLm+1Hhpk3
77pV0skh9erSjq6hKsLD1qS+pJtkkRt5YkMBMtpkvv1fWu1Pbx/0pSokIavnCZgX
ZQ7I0WVnj4L13Z4bZ4TaFL8CgYAP+UnZIR4PsCd12ZS4oUzzemBl6K+Wzm3vTb5X
va2BMI9fnYxQ1c1wJ8vy6cduaizMx3varLS0yenbQbVHr5/5nibpRLb6p7EJcr7V
cDUyIWrZw70v5CrqYr4yiroi0XZfaQ5YmenJvDlKwTArzYZWpVGtAmqb83XCc4BL
IFDZxQKBgQDNWZ1cySjjABAF16DXFJU3xBp9Q5PNjpknG0PNupzvtvbrT/PHKGGF
X2IPriYeD2ih6kI/thO1W3CdG+uRAZx7F7HC3XmNLwwEIG1CdDibQ7Ez9HGd8OXD
8AGUBMNiXe5CFNnaRtLuIUw0eRF7UtVVwFro1B4fCUDiD/EPDTDU9A==
-----END RSA PRIVATE KEY-----
EOF

echo "... writing public key" >> mc_install.log
cat <<EOF > /root/.ssh/github_rsa.pub
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCzMU/BplKAhFBVIsP+4tPEpeQfbCRYnelD6rn5PkuyJvSIFBwXPnbIHcoqOIfyPODwea6CCtMYU0BlPsiAtzgh9MJFvPHVDA+ZpG4QDoraXjybNLAK4D7PfSohrdl3GnxvO7KV4ojThCB0j3+HYHPbK3C+k6ByRCpvqjL8THlhI4zeAb9smhMO6iuE43fvkkwUTDmqdeRsjV6+BLD1EhRIyAMt7NwFhy9vjJUTMoHrAoimej1Y5CKN3JLXFTGm001V7W6VmnFutbjmoIlVyWQcfm7dG5eRIhgZ1DcvJJAiXgZR7ACJJAkEvrFxJ6IhRyJfDC3Lt5SLffOUzTeOFD+l root@pi-musicoinorg-1
EOF

echo "... writing ~/.ssh/config" >> mc_install.log
cat <<EOF > /root/.ssh/config
host github.com
 HostName github.com
 IdentityFile /root/.ssh/github_rsa
 User git
EOF

echo "Pulling from git hub..." >> mc_install.log
cd /
git clone git@github.com:Musicoin/musicoin.org.git
chmod +x /musicoin.org/script/100_install.sh

# Let the install script that comes with the repo do the rest
echo "Starting install script..." >> mc_install.log
/musicoin.org/script/100_install.sh >> mc_install.log 2>&1

else
  echo "Rebooting..." >> mc_install.log
fi