# İstanbul Trafik

İstanbul ilçelerinde yol ağı kurup büyüyen trafiği yönettiğiniz, tarayıcıda çalışan 2D trafik
simülasyonu ve şehir planlama oyunu.

> ### ▶ Sadece oynamak mı istiyorsunuz?
>
> Hiçbir şey kurmanıza gerek yok, oyun tarayıcıda açılır:
> **[alptekinsunnetci.github.io/istanbul-trafik](https://alptekinsunnetci.github.io/istanbul-trafik/)**
>
> Bilgisayarda ve telefonda çalışır. Aşağıdaki kurulum adımları yalnızca projeyi geliştirmek veya
> kendi sunucunuzda yayınlamak isteyenler içindir.

Her iş yerinin bir rengi ve sembolü vardır; aynı renkteki evlerden arabalar oraya gider. Oyuncu
evleri iş yerlerine yolla bağlar. İş yerlerinde bekleyen yolculuklar (raptiyeler) birikir; biri
taşarsa çevresindeki kırmızı halka dolar ve halka tamamen dolunca oyun biter. Skor, tamamlanan
yolculuk sayısıdır. Her hafta yeni yol parçaları gelir ve iki ödülden biri seçilir; şehir büyüdükçe
yeni renkler eklenir.

- **Haritalar:** Kadıköy, Beşiktaş, Üsküdar, Fatih, Şişli, Bakırköy. Her biri ilçenin kıyı, dere ve
  park düzenini sadeleştirilmiş, özgün bir ızgarada yorumlar; binalar gerçek mahalle adlarını taşır.
- **Sunucu gerekmez:** Oyun tamamen istemci tarafında çalışır. Statik dosya sunan herhangi bir
  web sunucusu (Nginx) yeterlidir. Harici API, CDN, hesap veya telemetri yoktur.

## Oyunda neler var?

- **Hazır otoyollar ve şehir dışı trafiği:** D-100 (E-5), O-1, Atatürk Bulvarı ve Büyükdere Caddesi
  haritada hazırdır, hızlıdır ve silinemez. Harita kenarından gri araçlar gelir: çoğu şehirden geçip
  gider, bir kısmı otoyola bağladığın ev ve iş yerlerine girer, bir kısmı da iş yerlerinden çıkıp
  otoyola katılır. Skora sayılmazlar ama yolları doldururlar.
- **Otoyol kavşakları:** Yolunu otoyolun herhangi bir yerine bağlayabilirsin. Ana yol önceliklidir:
  otoyoldaki araçlar yavaşlamaz, yan yoldan gelen araç boşluk bekler.
- **Trafik ışıkları:** Işık aracını seçip bir kavşağa dokun. Kuzey–güney ve doğu–batı yönleri sırayla
  yeşil yanar, bekleyen olmayan yönde erken döner. Işıksız kavşakta çapraz trafik varken sürücüler
  yavaşlayıp yol verir; yoğun kavşakta ışık bu yüzden belirgin şekilde hızlıdır.
- **Dereler ve karşı kıyılar:** Kurbağalıdere, Ayamama Deresi, Haliç ve Boğaz haritayı parçalara ayırır.
  Şehir karşı kıyıda da büyür, oraya köprüyle ulaşırsın. Suyu olmayan Şişli'de köprü verilmez.
- **Haftalık ödüller:** +15 yol, +5 köprü, +10 bulvar ya da +2 trafik ışığı.
- **Kolay başlangıç:** Rahat / Normal / Zor modları, isteğe bağlı rehberli öğretici, geri al, büyüyen
  oyun alanı ve tek seferlik ipuçları.

## Ekran görüntüleri

![Beşiktaş: O-1 otoyolu, Boğaz kıyısı ve trafik ışıklı bir kavşak](docs/screenshots/besiktas.png)

| Otoyol kavşağı ve trafik ışığı                                                             | Bakırköy: D-100, Ayamama Deresi, Marmara                                    |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| ![Sokağın D-100'e bağlandığı kavşak ve ışıklı kavşak](docs/screenshots/otoyol-kavsagi.png) | ![Bakırköy'de otoyol, dere köprüsü ve deniz](docs/screenshots/bakirkoy.png) |

| Ana menü                                                                                  |
| ----------------------------------------------------------------------------------------- |
| ![İlçe seçimi, zorluk modları ve otoyollu harita önizlemeleri](docs/screenshots/menu.png) |

## Gereksinimler

Önerilen yol **yalnızca Docker** kullanmaktır; ana makineye Node.js kurmanız gerekmez.

| Araç                           | Sürüm                                               | Not                                                      |
| ------------------------------ | --------------------------------------------------- | -------------------------------------------------------- |
| Docker Engine / Docker Desktop | 24+ (Compose v2 ile)                                | Tüm geliştirme, test ve derleme container içinde çalışır |
| Node.js (isteğe bağlı)         | 22.12+ (container: 22.23.3)                         | Yalnızca Docker'sız çalışmak isterseniz                  |
| npm (isteğe bağlı)             | 10+                                                 | `package-lock.json` ile sabitlenmiş bağımlılıklar        |
| Tarayıcı                       | WebGL destekli güncel Chrome, Edge, Firefox, Safari | Mobil/tablet temel düzeyde desteklenir                   |

## Hızlı başlangıç (Docker)

```bash
# Üretim sürümünü derle ve çalıştır (typecheck + lint + testler imaj içinde çalışır)
docker compose up -d --build web
# → http://localhost:8080
```

## Geliştirme (Docker)

`dev` servisi kaynak klasörünü bağlar; `node_modules` Linux'a özgü olduğu için adlandırılmış bir
Docker biriminde tutulur.

```bash
docker compose run --rm dev npm ci              # bağımlılıkları kur (ilk sefer)
docker compose --profile dev up dev             # Vite geliştirme sunucusu → http://localhost:5173
docker compose run --rm dev npm run typecheck   # TypeScript (strict)
docker compose run --rm dev npm run lint        # ESLint
docker compose run --rm dev npm test            # birim + entegrasyon testleri (Vitest)
docker compose run --rm dev npm run check       # typecheck + lint + biçim + testler
docker compose run --rm dev npm run build       # üretim derlemesi → dist/
docker compose run --rm dev npm run bench       # 15 dakikalık, ~500 araçlı kararlılık/performans testi
docker compose run --rm e2e                     # Playwright tarayıcı testleri (Chromium + mobil)
```

Tarayıcı testleri, sürüm uyumlu Playwright imajında (`mcr.microsoft.com/playwright:v1.63.0-noble`)
çalışır; tarayıcı kurulumu gerekmez. Çalışan bir yayına karşı test etmek için:

```bash
docker compose up -d web
docker run --rm --network istanbul-trafik_default -e E2E_BASE_URL=http://web \
  -v "$PWD:/app" -v istanbul-trafik_e2e_node_modules:/app/node_modules -w /app --ipc=host \
  mcr.microsoft.com/playwright:v1.63.0-noble npx playwright test
```

> Windows'ta Docker Desktop bind mount'larında dosya izleme olaylarını iletmediği için `dev`
> servisi `VITE_USE_POLLING=true` ile çalışır.

## Docker'sız çalışma (isteğe bağlı)

```bash
npm ci
npm run dev          # http://localhost:5173
npm run check
npm run build
npm run preview      # derlenmiş dist/ → http://localhost:4173
npx playwright install --with-deps chromium   # bir kez: tarayıcı ikilisi
npm run test:e2e
```

## Paket komutları

| Komut                     | Açıklama                                                |
| ------------------------- | ------------------------------------------------------- |
| `dev`                     | Vite geliştirme sunucusu                                |
| `build`                   | Üretim derlemesi (`dist/`)                              |
| `preview`                 | `dist/` klasörünü yerelde sunar                         |
| `typecheck`               | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`)     |
| `lint`                    | ESLint (tip bilgili kurallar)                           |
| `format` / `format:check` | Prettier                                                |
| `test` / `test:watch`     | Vitest birim + entegrasyon testleri                     |
| `test:e2e`                | Playwright tarayıcı testleri                            |
| `bench`                   | Uzun süreli performans ve kararlılık testi              |
| `check`                   | typecheck + lint + biçim + test                         |
| `build:prod`              | `check` başarılıysa `build`                             |
| `licenses`                | `docs/THIRD_PARTY_LICENSES.md` dosyasını yeniden üretir |

## Nasıl oynanır?

| Kontrol                                    | İşlev                                              |
| ------------------------------------------ | -------------------------------------------------- |
| Binadan başlayıp diğer binaya sürükle      | Yol çiz; uçlar binaların girişine yapışır          |
| Geri al düğmesi, `Ctrl+Z`                  | Son çizimi geri al, parçalar geri gelir            |
| Sil düğmesi ya da sağ tık + sürükle        | Yolu sil, parçalar geri gelir                      |
| Işık düğmesi, sonra kavşağa dokun          | Trafik ışığı koy; tekrar dokununca kalkar          |
| Araca veya binaya dokunma                  | Ayrıntıları göster                                 |
| Tekerlek, `+` / `−`, iki parmakla kıstırma | Yakınlaştır / uzaklaştır                           |
| Orta tık + sürükle, `W A S D`, iki parmak  | Haritayı kaydır                                    |
| `Boşluk`                                   | Duraklat / devam                                   |
| `1` · `2` · `3` · `4`                      | Yol · Bulvar · Silgi · Trafik ışığı                |
| `T` · `I` · `F`                            | Trafik katmanı · İstatistikler · Haritayı sığdır   |
| `Esc` veya ←                               | Menü (istatistik, yeniden başlat, ayarlar, yardım) |

- **Parçalar:** Her kara hücresi 1 yol parçası, her su hücresi 1 köprü parçası kullanır. Bulvar
  (iki şeritli, hızlı yol) mevcut yolun üstüne çizilir ve hücre başına 1 bulvar parçası kullanır.
- Her hafta (90 sn) +20 yol parçası gelir ve iki ödülden biri seçilir (+15 yol, +5 köprü, +10 bulvar,
  +2 trafik ışığı). Oyun seçim yapılana kadar bekler. Suyu olmayan ilçede (Şişli) köprü verilmez.
- **Su ve köprüler:** Kurbağalıdere (Kadıköy), Ayamama Deresi (Bakırköy), Haliç'in karşı kıyısı (Fatih)
  ve Boğaz'ın Anadolu kıyısı (Beşiktaş) haritayı parçalara ayırır. Şehir büyüdükçe bazı binalar karşı
  kıyıda çıkar; oraya ancak köprüyle ulaşılır.
- **Hazır otoyollar:** D-100 (E-5), O-1, Atatürk Bulvarı ve Büyükdere Caddesi haritada hazırdır. Bunlar
  hızlıdır (90 km/sa) ve silinemez. Harita kenarından gelen gri araçların çoğu şehirden geçip gider; bir
  kısmı otoyola bağladığın ev ve iş yerlerine girer, bir kısmı da iş yerlerinden çıkıp otoyola katılır.
  Bu araçlar skora ve raptiyelere sayılmaz, ama yolları doldurur.
- **Trafik ışığı:** Işıksız kavşakta karşı yönden araç gelirse sürücüler yavaşlayıp yol verir. Işık
  kuzey–güney ve doğu–batı yönlerine sırayla yeşil yakar; bekleyen olmayan yönde erken döner. 2 ışıkla
  başlanır; ışık kaldırılınca ya da kavşak silinince parçası geri gelir.
- **Zorluk:** Rahat (oyun bitmez, sakin tempo), Normal (varsayılan) ve Zor. Seçim hatırlanır; en iyi
  skorlar ilçe ve mod başına ayrı tutulur.
- **Oynayarak öğren:** Menüdeki rehberli oyun 4 adımda anlatır; saat ilk yol bağlanana kadar bekler.
- **Büyüyen alan:** Oyun küçük bir alanla başlar (dikey ekranda dikey), her hafta genişler; kamera
  alanı kendiliğinden sığdırır, kaydırma ve yakınlaştırma isteğe bağlıdır.
- Aynı **harita tohumu** aynı başlangıç haritasını ve trafik akışını üretir.

## Mimari özeti

Ayrıntılar: [ARCHITECTURE.md](ARCHITECTURE.md).

```
src/core       sabitler, deterministik PRNG, olay yolu, sabit adımlı simülasyon
src/map        ızgara, yol düzenleyici, topoloji → yönlü yol grafiği, geometri, ilçeler
src/traffic    araç modeli, IDM takip, şerit değiştirme, kavşak rezervasyonu, A* rota, talep, kuyruk
src/gameplay   oturum, skor/memnuniyet, zorluk, oyun sonu, kayıt anlık görüntüsü
src/persistence  sürümlü kayıt şeması, doğrulama, göç, localStorage yöneticisi
src/rendering  PixiJS çizimi (salt okuma): zemin, yollar, binalar, araçlar, efektler, kamera
src/ui         DOM arayüzü: HUD, araç çubuğu, menüler, ayarlar, istatistik, girdi
src/app        giriş noktası, durum makinesi, oyun döngüsü, denetleyici, ses
```

Simülasyon çekirdeği (`core`, `map`, `traffic`, `gameplay`, `persistence`) PixiJS'e ve DOM'a bağımlı
değildir. Bu sınır ESLint kuralıyla zorlanır.

## Kayıtlar

Ayarlar, en iyi skorlar, son 20 oyunun özeti ve devam edilebilir aktif oyun yalnızca tarayıcının
`localStorage` alanında tutulur. **Sunucuya yedeklenmez**; tarayıcı/site verileri silinirse kaybolur.
Bozuk veya uyumsuz kayıtlar uygulamayı çökertmez: güvenli varsayılanlara dönülür ve kullanıcıya bildirilir.

## Bilinen sınırlamalar

- Tek yön motorda desteklenir ama sade arayüzde sunulmaz. Trafik ışıkları iki fazlıdır (kuzey–güney /
  doğu–batı); ayrı sola dönüş fazı yoktur. Işıksız kavşaklar çakışma bölgesi rezervasyonu ve yol verme
  kuralıyla yönetilir.
- Otoyollar haritada sabittir; kavşaklar hemzemindir (rampa veya kavşaksız katılım yoktur), ana yol
  önceliklidir.
- Bulvar en fazla 2 şerit/yöndür. Şerit değiştirme yalnızca aynı yol parçası içinde yapılır.
  Dönüş için doğru şeride geçemeyen araç, durma çizgisinde son çare olarak yanlış şeritten döner.
- Yol hücreleri ızgaraya bağlıdır (90° dönüşler). Su üzerinde köprü kurulabilir, ancak alt/üst geçit
  (kavşaksız kesişme) yoktur: kesişen yollar her zaman kavşak oluşturur.
- Ses efektleri Web Audio ile sentezlenir; müzik yoktur.
- Performans hedefi (60 FPS) yalnızca headless Chromium'da yazılım (SwiftShader) render ile işlevsel
  olarak denenmiştir; gerçek cihazlarda FPS ölçümü yapılmamıştır. Simülasyon tik süreleri ölçülmüştür
  (bkz. ARCHITECTURE.md → Performans).
- Mobil cihazlar yalnızca Playwright'ın Pixel 7 emülasyonunda test edilmiştir; gerçek cihazda test edilmemiştir.
- Proje adı, logo ve marka uygunluğu araştırılmamıştır; ticari yayından önce ayrıca kontrol edilmelidir.

## Lisans

Kaynak kod: [LICENSE](LICENSE). Üçüncü taraf paketler: [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md).
Tüm oyun görselleri ve sesleri kodla üretilir; harici varlık kullanılmaz.
