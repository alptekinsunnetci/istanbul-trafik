# Yayına alma (Ubuntu + Nginx)

İstanbul Trafik statik bir web uygulamasıdır. Üretim derlemesi `dist/` klasörünü üretir; bu klasörü
sunan herhangi bir web sunucusu yeterlidir. Aşağıda iki yol anlatılır:

- **A. Docker ile:** Sunucuda yalnızca Docker gerekir. Önerilen yol budur.
- **B. Ana makinedeki Nginx ile:** `dist/` klasörü sistem Nginx'inin web köküne kopyalanır.

Bu belge Ubuntu 22.04/24.04 LTS için yazılmıştır. Komutlar `sudo` yetkili bir kullanıcıyla çalıştırılır.
`oyun.example.com` alan adını kendi alan adınızla değiştirin.

> Bu belgedeki komutlar geliştirme ortamında Docker ile doğrulanmıştır: imaj derlemesi, Nginx
> container'ı, HTTP başlıkları ve container'a karşı Playwright testleri. Gerçek bir Ubuntu sunucusuna
> dağıtım ve TLS sertifikası alma adımları **bu proje kapsamında denenmemiştir.**

---

## 1. Sistem paketleri

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
```

## 2. Docker (yol A) veya Node.js (yol B, isteğe bağlı)

**Yol A – Docker Engine ve Compose eklentisi:**

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version && docker compose version
```

**Yol B – derlemeyi Docker ile alıp yalnızca Nginx kullanmak:** Node.js kurmanız gerekmez; derleme
Docker içinde yapılır (adım 6B). Docker kurmak istemiyorsanız Node.js 22 LTS kurun:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v22.12 veya üzeri
npm -v    # 10 veya üzeri
```

## 3. Kaynakları sunucuya alma

```bash
sudo mkdir -p /opt/istanbul-trafik && sudo chown "$USER" /opt/istanbul-trafik
git clone <depo-adresi> /opt/istanbul-trafik      # veya: scp/rsync ile proje klasörünü kopyalayın
cd /opt/istanbul-trafik
```

## 4. Bağımlılık kurulumu (`npm ci`)

Docker yollarında bu adım imaj derlemesinin içinde otomatik yapılır (`Dockerfile` → `deps` aşaması).
Node.js kurulu ise:

```bash
npm ci
```

## 5. Testler

```bash
# Docker:
docker build --target check -t istanbul-trafik:check .     # typecheck + lint + biçim + birim/entegrasyon
# Node.js:
npm run check
```

İsteğe bağlı tarayıcı testleri (sunucuda Docker gerekir):

```bash
docker compose run --rm e2e
```

## 6. Üretim derlemesi

### 6A. Docker imajı (Nginx dahil)

```bash
docker compose build web          # kontroller geçmezse derleme durur
```

### 6B. Yalnızca `dist/` klasörü

```bash
# Docker ile (ana makinede Node.js gerekmez):
docker build --target dist --output type=local,dest=./dist .
# veya Node.js ile:
npm run build:prod
ls dist/   # index.html, favicon.svg, assets/
```

---

## Yol A: Docker ile çalıştırma

```bash
docker compose up -d web
docker compose ps                 # STATUS: healthy
curl -fsS http://127.0.0.1:8080/healthz
```

Container 8080 portunu dinler, salt okunur dosya sistemiyle çalışır ve yeniden başlatma politikası
`unless-stopped`'tır. Dışarıya 80/443 üzerinden açmak ve TLS sonlandırmak için önüne ters vekil koyun.
Ana makinedeki Nginx ile örnek (`/etc/nginx/sites-available/istanbul-trafik`):

```nginx
server {
    listen 80;
    server_name oyun.example.com;
    server_tokens off;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ardından adım 9–12'yi uygulayın. Uygulamanın kendi güvenlik başlıkları container'daki Nginx'ten gelir.

## Yol B: Ana makinedeki Nginx ile

### 7. `dist/` içeriğini web köküne kopyalama

```bash
sudo apt install -y nginx
sudo mkdir -p /var/www/istanbul-trafik/releases
RELEASE=/var/www/istanbul-trafik/releases/$(date +%Y%m%d%H%M%S)
sudo mkdir -p "$RELEASE"
sudo cp -r dist/. "$RELEASE/"
sudo ln -sfn "$RELEASE" /var/www/istanbul-trafik/current
```

Her sürüm ayrı klasörde tutulur; `current` sembolik bağı etkin sürümü gösterir. Bu, anında geri
dönüşü mümkün kılar (bkz. adım 13).

### 8. Sahiplik ve izinler

```bash
sudo chown -R root:root /var/www/istanbul-trafik
sudo find /var/www/istanbul-trafik -type d -exec chmod 755 {} \;
sudo find /var/www/istanbul-trafik -type f -exec chmod 644 {} \;
```

Nginx (`www-data`) dosyaları yalnızca okur; yazma izni gerekmez.

### 9. Nginx yapılandırmasını etkinleştirme

Depodaki `nginx.conf` bir `server` bloğudur. Web kökünü değiştirerek kopyalayın:

```bash
sudo cp nginx.conf /etc/nginx/sites-available/istanbul-trafik
sudo sed -i 's#root /usr/share/nginx/html;#root /var/www/istanbul-trafik/current;#' /etc/nginx/sites-available/istanbul-trafik
sudo sed -i 's#server_name _;#server_name oyun.example.com;#' /etc/nginx/sites-available/istanbul-trafik
sudo ln -sfn /etc/nginx/sites-available/istanbul-trafik /etc/nginx/sites-enabled/istanbul-trafik
sudo rm -f /etc/nginx/sites-enabled/default    # varsayılan site başka iş için kullanılmıyorsa
```

Yapılandırmanın sağladıkları:

- `index.html` için `Cache-Control: no-cache`; içeriğe göre adlandırılan `/assets/*` için 1 yıl `immutable`.
- Bilinmeyen yollar `index.html`'e düşer (doğrudan URL erişimi).
- `server_tokens off`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` ve `unsafe-eval` içermeyen sıkı bir `Content-Security-Policy`.
- Gizli dosyalara (`/.git`, `/.env`) erişim 403; `/healthz` sağlık kontrolü.
- MIME tipleri Nginx'in `mime.types` dosyasından gelir (Ubuntu ve resmi imajda varsayılan olarak yüklenir).

### 10. Yapılandırma testi

```bash
sudo nginx -t
```

### 11. Nginx'i yeniden yükleme

```bash
sudo systemctl reload nginx
sudo ufw allow 'Nginx Full'    # UFW kullanıyorsanız (80 + 443)
```

### 12. HTTP/HTTPS kontrolü

```bash
curl -I http://oyun.example.com/                # 200, Cache-Control: no-cache, CSP başlığı
curl -I http://oyun.example.com/healthz         # 200
curl -s http://oyun.example.com/ | grep -o '<title>.*</title>'
```

**TLS:** Nginx bloğu TLS sonlandırmaz; sertifika olduğu varsayılmaz. Alan adının DNS `A`/`AAAA`
kaydı sunucuyu gösterdikten sonra örneğin Let's Encrypt ile:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d oyun.example.com     # 443 bloğunu ve HTTP→HTTPS yönlendirmesini ekler
sudo certbot renew --dry-run
curl -I https://oyun.example.com/
```

Bir yük dengeleyici, Cloudflare veya başka bir ters vekil TLS'i sonlandırıyorsa sunucuda yalnızca 80
portu açık kalabilir. HTTPS'e geçtikten sonra isteğe bağlı olarak
`add_header Strict-Transport-Security "max-age=31536000" always;` ekleyin.

Ardından tarayıcıda açıp ana menünün yüklendiğini, yeni oyun başlatılabildiğini ve geliştirici
konsolunda hata olmadığını doğrulayın.

---

## 13. Güncelleme ve geri dönüş

### Docker (yol A)

```bash
cd /opt/istanbul-trafik
docker tag istanbul-trafik:latest istanbul-trafik:previous     # mevcut sürümü sakla
git pull
docker compose build web && docker compose up -d web
docker compose ps && curl -fsS http://127.0.0.1:8080/healthz
```

Geri dönüş:

```bash
docker tag istanbul-trafik:previous istanbul-trafik:latest
docker compose up -d --no-build web
```

### Ana makine Nginx (yol B)

```bash
cd /opt/istanbul-trafik && git pull
docker build --target dist --output type=local,dest=./dist .    # veya: npm ci && npm run build:prod
RELEASE=/var/www/istanbul-trafik/releases/$(date +%Y%m%d%H%M%S)
sudo mkdir -p "$RELEASE" && sudo cp -r dist/. "$RELEASE/"
sudo ln -sfn "$RELEASE" /var/www/istanbul-trafik/current
sudo nginx -t && sudo systemctl reload nginx
```

Geri dönüş, bağı önceki klasöre çevirmektir:

```bash
ls -1 /var/www/istanbul-trafik/releases          # sürümleri listele
sudo ln -sfn /var/www/istanbul-trafik/releases/<önceki-sürüm> /var/www/istanbul-trafik/current
sudo systemctl reload nginx
```

Eski sürümleri temizleme (son 5'i tut):

```bash
ls -1dt /var/www/istanbul-trafik/releases/* | tail -n +6 | xargs -r sudo rm -rf
```

### Kayıt uyumluluğu

Oyuncu verileri tarayıcıda tutulur ve sunucu güncellemesinden etkilenmez. Kayıt formatı sürümlüdür;
yeni bir sürüm eski kaydı okuyamazsa uygulama çökmez, kaydı silip oyuncuyu bilgilendirir.
