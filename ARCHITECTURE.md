# Mimari

## Katmanlar ve bağımlılık sınırları

```
app ──► ui ──► rendering ──► (salt okuma) gameplay ─► traffic ─► map ─► core
  └──────────────────────────────────────► persistence ─┘
```

| Katman        | Sorumluluk                                                                                               | PixiJS/DOM |
| ------------- | -------------------------------------------------------------------------------------------------------- | ---------- |
| `core`        | Sabitler (`constants.ts`), PRNG, olay yolu, sabit adım hesaplayıcı, `Simulation`                         | Hayır      |
| `map`         | `Grid`, yol düzenleyici, topoloji → `RoadGraph`, şerit/kavşak geometrisi, ilçeler, harita üretimi        | Hayır      |
| `traffic`     | Araç modeli, IDM, şerit değiştirme, şerit yöneticisi, kavşak denetleyicisi, A*, talep, kuyruk/kilitlenme | Hayır      |
| `gameplay`    | Oturum (ekonomi, büyüme, skor, oyun sonu), anlık görüntü (kaydet/yükle)                                  | Hayır      |
| `persistence` | Sürümlü şema, doğrulama, göç, `SaveManager`                                                              | Hayır      |
| `rendering`   | PixiJS çizimi; simülasyonu yalnızca okur                                                                 | Evet       |
| `ui`          | DOM arayüzü, girdi                                                                                       | Evet       |
| `app`         | Giriş noktası, durum makinesi, `requestAnimationFrame` döngüsü, denetleyici, ses                         | Evet       |

Çekirdek katmanların `pixi.js`, `rendering`, `ui` veya `app` içe aktarması ESLint
(`no-restricted-imports`) ile engellenir. Böylece simülasyon Node.js'te tarayıcısız test edilir.

## Uygulama durumları

`loading → menu → ready → playing ⇄ paused → gameover`, ayrıca `error`. Ayarlar ve yardım, durumların
üzerinde açılan katmanlardır (`overlay`). Bir katman açıkken simülasyon ilerlemez. Geçişler
`AppStateMachine` içindeki tabloyla doğrulanır.

## Zaman

- Simülasyon sabit **20 adım/sn** ile ilerler (`SIM.tickRate`). Çizim ekran hızındadır; araç konumları
  son iki adım arasında enterpole edilir.
- `FixedStepper` kare süresini en fazla 0,25 sn sayar ve kare başına en fazla 12 adım çalıştırır.
  Arka plandaki sekme geri döndüğünde zaman sıçraması olmaz; yavaş cihazda oyun ağır çekime düşer
  ama "ölüm sarmalına" girmez.
- Simülasyon hiçbir zaman duvar saatini okumaz. Aynı tohum, harita ve düzenleme sırası aynı sonucu
  üretir (determinizm testi: `session.test.ts`).

## Yol ağı modeli

1. **Izgara** (`Grid`, varsayılan 64×64, hücre = 16 m): arazi (kara/su/park), yol hücreleri, hücreler
   arası **yönlü bağlantılar** (bit maskesi), şerit sayısı (1/2), kilitli bina kapıları.
   Çizilen her şey bağlantılardan türetilir: görsel olarak bitişik iki paralel yol bağlı değildir;
   çizgi bir yolu kestiğinde kesişim hücresi kavşak olur.
2. **Topoloji** (`buildGraph`): Düz geçiş olmayan her hücre bir düğümdür: kavşak, çıkmaz, bina kapısı,
   şerit sayısı veya yön deseni değişimi. Düğümler arasındaki her zincir en fazla iki **yönlü kenara**
   dönüşür. Kenar kimliği `"<başlangıç hücresi>><ilk yön>"` biçimindedir ve zincir değişmedikçe sabit
   kalır. Kenarın şerit sayısı, uzunluğu, hız sınırı, serbest akış süresi, ikizi (karşı yön) ve
   değişiklik imzası vardır.
3. **Düzenleme sonrası:** Grafik yeniden kurulur. Araçlar bulundukları **hücre adımı** (a→b) üzerinden
   yeni kenarlara eşlenir. Yalnızca yolu gerçekten silinen araçlar başarısız sayılır ve oyuncuya
   bildirilir. Rota önbelleğinde yalnızca değişen kenarları kullanan kayıtlar geçersiz kılınır.
   Geçersizleşen rotalar yeniden planlanır.

## Araç dinamiği

- **IDM** (Intelligent Driver Model): istenen hız, güvenli zaman aralığı (1,2 sn), en küçük boşluk
  (2 m), konforlu fren (2,4 m/s²). Balistik entegrasyon negatif hız veya geri hareket üretmez.
  Öndeki aracın arka tamponuna karşı ayrıca sert bir sınır uygulanır, böylece çakışma oluşmaz.
- Dönüşten önce araç dönüş hızına (7 m/s) konforlu biçimde yavaşlar.
- **Şerit değiştirme** (MOBIL benzeri): zorunlu (dönüş şeridine geçiş, durma çizgisine yaklaştıkça
  esneyen güvenlik eşiği) ve isteğe bağlı (kazanç eşiği + nezaket katsayısı). Yeni öndeki ve arkadaki
  araçlara güvenli mesafe ve en fazla 3 m/s² fren koşulu aranır. Manevra 1,8 sn sürer; bu sürede araç
  iki şeritte birden yer kaplar.
- **Kuyruklar:** Her şeritte araçlar konuma göre sıralanır. Kuyruk, durma çizgisinden başlayan kesintisiz
  yavaş (< 1,5 m/s) araç dizisidir. En uzun/ortalama kuyruk, yoğunluk (araç/km) ve kullanım oranı bu
  verilerden hesaplanır.

## Kavşaklar

- Her düğüm kutusu dört **çakışma bölgesine** (çeyrek) ayrılır. Sağdan trafikte sağa dönüş 1, düz 2,
  sola dönüş 3, U dönüşü 4 bölge kullanır. Bölge kümeleri kesişen hareketler çakışır.
- Araç durma çizgisine konforlu fren mesafesi kadar yaklaşınca **rezervasyon** ister. Bir adımdaki
  bütün istekler tek seferde (atomik) çözülür. İstek ancak tüm bölgeleri boşsa **ve** çıkış şeridinin
  başında aracın sığacağı yer varsa (önceki rezervasyonlar düşülerek) onaylanır. Çıkışı dolu kavşağa
  girilmez; tıkanıklık geriye yayılır, kavşak içinde duran araç olmaz.
- Bölgeler, aracın arka tamponu kutudan çıkana kadar tutulur. Aynı hareketi izleyen ardışık araçlar
  (müfreze) bölgeleri paylaşabilir.
- **Adalet:** İstekler bekleme süresine göre sıralanır ("en uzun bekleyen önce"). 6 sn'den uzun bekleyen
  istek, bölgelerini düşük öncelikli isteklere (ve müfrezelere) kapatır; böylece açlık oluşmaz.
- **Kilitlenme tespiti:** Durma çizgisinde, çıkış şeridinde yer bekleyen lider araçlardan bir
  "bekleme grafiği" kurulur. Döngüler kilitlenme olarak raporlanır ve haritada işaretlenir. Araçlar
  ışınlanmaz; uzun bekleyenler alternatif rota arar.
- Sıralama politikası `JunctionPolicy` arayüzüyle değiştirilebilir.
- **Yol verme:** Işıksız ve en az üç kollu bir kavşakta, çapraz yoldan 30 m içinde araç varsa (ya da
  kutuda çapraz yönden bir araç varsa) araç ancak durma çizgisine 5 m kala ve 3 m/sn altına yavaşlayınca
  rezervasyon isteyebilir (`JUNCTION.yield*`). Çapraz trafik yoksa hızını korur.
- **Trafik ışığı** (`grid.signal`, `SIGNAL`): Talebe duyarlı iki fazlı ışık. Kuzey–güney ve doğu–batı
  yönleri sırayla yeşil yanar. Yeşil en az 4 sn sürer; o yönde bekleyen yoksa ve diğer yönde varsa erken,
  en geç 14 sn sonra biter. Fazlar arasında kutu boşalana kadar (en az 1,5 sn) her yön kırmızıdır.
  Dedektör olarak o adımın rezervasyon istekleri kullanılır. Kırmızıdaki istekler hiç değerlendirilmez
  (başkasını da engellemez). Yoğun dört yönlü bir kavşakta ölçüm: 100 araç ışıksız 274 sn, ışıklı 232 sn
  (testte ışığın daha hızlı olduğu doğrulanır).

## Rota motoru

- **Kenar tabanlı A\*:** Durum = yönlü kenar. Bu sayede U dönüşü kuralı (yalnızca çıkmazda) ve dönüş
  maliyetleri tam olarak modellenir.
- **Maliyet:** serbest akış süresi + kuyruktaki araç/şerit × 1,8 sn + ölçülen kavşak gecikmesi (EMA) +
  6 × doluluk² + hareket maliyeti (kavşak 1,2 sn, dönüş +1 sn). Katsayılar `ROUTING` içindedir.
- **Sezgisel:** kuş uçuşu mesafe / ağdaki en yüksek hız sınırı. Her kenar maliyeti en az serbest akış
  süresi olduğundan sezgisel değer hiçbir zaman fazla tahmin etmez; A* en iyi rotayı bulur.
- **Önbellek:** 4 sn yaşam süresi (tıkanıklığı izlemek için), periyodik budama ve değişen kenarlara
  göre seçici geçersiz kılma.
- **Alternatif rota:** Araçlar 4 sn'de bir rotalarını yeniden değerlendirir. Yeni rota yalnızca %18 ve
  en az 4 sn daha iyiyse benimsenir (histerezis). Kavşağa girmiş veya rezervasyon almış araçların rotası
  değişmez. Rotası kalmayan araç durma çizgisinde bekler, 2 sn'de bir yeniden dener; 40 sn sonra
  yolculuk başarısız sayılır ve bildirilir.

## Talep ve oyun kuralları

- **Renk eşleşmesi:** Ev (`konut`) ve iş yeri (`ticari`) binalarının bir renk grubu vardır. Araçlar
  yalnızca aynı renkteki ev ile iş yeri arasında gider. Her grubun ayrıca bir sembolü vardır (daire,
  üçgen, kare, elmas, artı); eşleşme yalnızca renge dayanmaz.
- **Talep (raptiye):** Her iş yeri belli aralıklarla (10 sn'den başlayıp dakikada 0,45 sn kısalır,
  en az 3,5 sn; ilçe çarpanıyla) bir raptiye alır. Raptiye, aynı renkteki ulaşılabilir bir eve atanır.
  Yol bulamayan evdeki bekleyen yolculuklar her 2 sn'de bir ulaşılabilir evlere taşınır.
- **Tek kaybetme kuralı:** İş yerindeki raptiye sayısı (bekleyen + yoldaki araçlar) 7'ye ulaşınca taşma
  sayacı dolar, altına inince 1,5 kat hızla boşalır. Sayaç 45 sn'ye ulaşırsa oyun biter.
- **Skor:** tamamlanan yolculuk sayısı. Yarıda kalan araçların yolculuğu kaybolmaz, evin kuyruğuna geri döner.
- **Parçalar:** yol / köprü / bulvar parçaları sayılabilir kaynaklardır; silinen hücrenin parçası iade edilir.
  Haftada (90 sn) +20 yol gelir ve iki ödülden biri seçilir; seçim yapılana kadar oturum adım atmaz.
- **Büyüme:** 25. saniyeden itibaren 30→16 sn aralıklarla yeni bina (her 5. olay iş yeri). Ev, raptiye/ev
  oranı en yüksek renge eklenir. 2., 4., 6. ve 9. haftalarda yeni bir renk grubu (iş yeri + ev) gelir.
  Oyun alanında birden fazla kara parçası varsa (`landRegions`), yeni evlerin %30'u ve iş yerlerinin
  %45'i bağlı olduğu binanın karşı kıyısına konur; böylece köprüler gerçekten gerekir.
- **Otoyollar ve şehir dışı:** İlçe tanımındaki `highways` çoklu çizgileri haritaya hazır, kilitli, iki
  şeritli ve 25 m/sn'lik yollar olarak işlenir (`grid.highway`). Harita kenarındaki uçlara `kapi`
  türünde görünmez "şehir dışı bağlantısı" binaları konur. Her kapı 7→3,5 sn aralıklarla bir araç
  üretir: çoğu başka bir kapıya gider, %25'i otoyoldan ulaşılabilen bir ev ya da iş yerine girer,
  %20'si de bağlı bir iş yerinden bu kapıya çıkar. Bu araçlar (`isHighwayTrip`) skor, raptiye, taşma ve
  oyuncu istatistiklerine sayılmaz; otoyol tıkalıyken giremeyen araçlar birikmez, düşer.
- **Köprü olmayan ilçe:** Suyu olmayan haritada köprü parçası verilmez ve ödül olarak çıkmaz.

## Kolaylık ve erişilebilirlik

- **Modlar** (`MODES`): Rahat (talep 1,7 kat seyrek, taşma oyunu bitirmez), Normal (1,25 kat, 8 raptiye,
  60 sn), Zor (7 raptiye, 45 sn). Taşma sayacı 0–1 arası bir oran olarak tutulur.
- **Büyüyen oyun alanı** (`PLAYFIELD`): 18×12 hücreyle başlar (dikey ekranda 12×18), her hafta genişler.
  Binalar ve yollar alanın içinde kalır; dışı soluk çizilir; kamera alanı yumuşakça sığdırır ama oyuncu
  çizerken asla kımıldamaz.
- **Dönen girişler:** Henüz yola bağlı olmayan bir binanın girişi, yolun yaklaştığı tarafa döner
  (`entranceFacing`, `moveEntrance`); bağlı girişler yerinde kalır, geri al dönüşü de geri alır.
- **Yapışma ve akıllı doldurma** (`GameSession.prepareStroke`, `smoothStroke`): Binadan başlayan çizim
  binanın girişinden başlar, başka binaya ulaşınca onun girişinde biter; hızlı sürüklemede atlanan
  hücreler bina ve parkların etrafından dolaşılarak doldurulur.
- **Geri al:** Her çizimden önce yol katmanları ve parçalar saklanır (en fazla 30 adım; hafta başında
  sıfırlanır). Geri almada bina girişleri her zaman korunur.
- **Rehberli öğretici:** Sabit Kadıköy haritasında 4 adım (bağla → ilk araba → diğer evler → geri
  al/sil). Hedef evler başlangıçta sabitlenir, şehir büyüse de değişmez. Haftalık ödül penceresi bir
  çizim sürerken açılmaz, çizim bitince gelir.
- **Geri bildirim:** Bağlanmamış binaların girişinde renkli halka, her teslimatta "+1", rozetlerin altında
  metin etiketleri.

## Kayıt

- `toSnapshot` türetilmiş verileri (grafik, şerit listeleri, önbellekler) kaydetmez. Izgara katmanları
  base64, binalar/araçlar/istatistikler düz JSON olarak tutulur. Format `SAVE_VERSION` ile sürümlüdür.
  Güncel sürüm 4'tür: otoyollar, şehir dışı kapıları, trafik ışıkları (`grid.signal`) ve ışık parçaları
  da kaydedilir. Sürüm 1–3 kayıtları (eski kurallar ya da nehirsiz/otoyolsuz haritalar) yüklenmez;
  oyuncuya bildirilip silinir.
- Yükleme iki aşamalıdır. Önce yapısal doğrulama yapılır (tipler, aralıklar, boyut sınırları); ardından
  ilçe yeniden üretilip anlamsal tutarlılık kontrol edilir (bina yerleşimi, kapılar, araç kenarları,
  rota/konum uyumu). Hata olursa kayıt silinir ve oyuncu bilgilendirilir. Geri yüklenen oyun,
  kaydedildiği andaki oyunla adım adım aynı ilerler (test edilmiştir).

## Render

- Katmanlar: zemin → yer adları → yollar → trafik katmanı → binalar → bina durumu → araçlar → seçim →
  kilitlenme → önizleme → imleç.
- Her ilçenin kendi zemin/su/park tonu vardır (`District.palette` → `districtTheme`; yüksek kontrast
  teması etkilenmez). Su, kıyıya işaretli uzaklık alanından (hafif bulanıklaştırılmış) marching squares
  ile çizilir: açık kıyı bandı, su, açık denizde koyu bant ve seyrek nokta dokusu. Bu sayede kıyılar
  hücre basamağı yerine yumuşak eğri olur. Silik ızgara varsayılan olarak açıktır.
- Yer adları (BOĞAZ, HALİÇ, MARMARA DENİZİ, park adları) `placeLabels` ile yerleşir: adın tamamı kendi
  arazisinin üstüne, oynanabilir alanın içine ve başka bir adla çakışmadan sığmalıdır. Sığmayan ad,
  alan büyüyene kadar gösterilmez.
- İş yerleri kendi renginde yuvarlatılmış bir zemin üstünde durur; binaların sağ alta düşen uzun,
  yumuşak gölgeleri vardır. Görsel dil Mini Motorways'in genel ilkelerinden (sade, düz renkler, uzun
  gölge) esinlenir; o oyunun hiçbir varlığı, ikonu ya da çizimi kopyalanmamıştır.
- Zemin ve yollar yalnızca ağ değiştiğinde yeniden çizilir. Bina durumu ve trafik katmanı 4 Hz'de
  güncellenir. Araçlar, tür/renk başına tek bir paylaşılan `GraphicsContext` kullanan havuzlanmış
  `Graphics` nesneleridir.
- `pixi.js/unsafe-eval` içe aktarılır; böylece `unsafe-eval` içermeyen sıkı CSP altında çalışır
  (nginx container'ına karşı Playwright ile doğrulandı).

## Performans

Ölçüm: `npm run bench` (`tests/perf/stability.test.ts`), Docker Desktop (16 vCPU) içinde Node.js
22.23.3. Ortam: Şişli haritası, 86 bina, 638 yönlü kenar, 306 düğüm, 15 simüle dakika; yolculuklar
test tarafından ulaşılabilir ev–iş yeri çiftlerine enjekte edilir.

| Ölçüt                                 | Sonuç                                                       |
| ------------------------------------- | ----------------------------------------------------------- |
| Eşzamanlı araç (tepe / ortalama)      | 514 / 490                                                   |
| Simülasyon adımı ortalama / p95 / p99 | 2,9 ms / 4,5 ms / 6,0 ms (bütçe: 50 ms/adım)                |
| Tamamlanan yolculuk (15 dk)           | 790 (şehir genelinde rastgele hedefler)                     |
| Kilitlenme / çakışma / NaN            | 0 / 0 / 0 (her 200 adımda doğrulandı)                       |
| Rota önbelleği boyutu (sonda)         | 381 kayıt (sınırlı)                                         |
| Yığın artışı                          | 4–36 MB (GC zamanlamasına bağlı; sınırsız artış gözlenmedi) |

Tarayıcıda FPS ölçülmemiştir. Headless Chromium yazılım render kullandığı için gerçek cihazı temsil etmez.

## Önemli kararlar ve varsayımlar

- **Hücre boyutu 16 m, kavşak kutusu 6 m:** İki bitişik kavşak arasında bile en az bir aracın sığacağı
  10 m yol kalır. Bu, kapasite modelinin kendi kendine kilitlenmesini önler.
- **Araçlar görselde büyütülür** (boy ×1,3, en ×1,55; kuyruk aralığını aşmaz): Fizik gerçek boyutları kullanır.
- **Haritaya gömülü arayüz:** Kart veya panel yoktur. Sol üstte geri oku ve ilçe adı; sağ üstte skor, gün ve haftayı gösteren saat halkası (tıklayınca duraklatır) ile hız; altta yol, köprü, bulvar sayaç rozetleri ve silgi bulunur. Su ve parklar hücre birleşimlerinden yumuşak, organik şekillerle; binalar gölgeli küplerle çizilir. Sol tık çizer, sağ tık siler; inceleme için araca/binaya dokunulur. Tek yön (`toggleOneWay`) motorda ve testlerde vardır ama sadelik için arayüzde sunulmaz.
- **Kapı başına bir araç çıkışı:** Bina kapısı bir düğümdür; çıkış, kavşak bölgelerinin boş olmasını
  ve şeritte yer olmasını gerektirir.
- **Vitest 5.0.5:** 5.0.3 sürümü npm 10.9'da `edgesOut` hatasıyla kurulamadığı için seçildi.
  **Vite 8.3.4:** 8.3.0–8.3.2 aralığındaki geliştirme sunucusu açığını (launch-editor) kapatan sürüm.
- **TypeScript 5.9.3:** typescript-eslint 8.71 TypeScript < 6.1 destekler.
