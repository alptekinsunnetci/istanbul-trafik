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
  rezervasyon isteyebilir (`JUNCTION.yield*`). Çapraz trafik yoksa hızını korur. Otoyol kavşaklarında
  ana yol önceliklidir: otoyoldaki araçlar hiç yol vermez. Yan sokaktan sağa dönüp katılan araç (rampa)
  yalnızca katılacağı yönde otoyolda araç yaklaşırken yol verir; karşıya geçen ya da sola dönen araç
  yakındaki her araca yol verir. Haritada bu kavşaklar sokağın otoyola kavisli bordürlerle açıldığı bir
  ağız, iki yanda katılma/ayrılma şeridi gibi açılan kenar çizgisi ve kenar çizgisinde boşlukla çizilir.
- **Üst geçit** (`grid.overpass`): Otoyolun düz, kavşaksız bir hücresini dik ve düz kesen çizim o hücreyi
  üst geçit yapar (1 köprü parçası; parça yoksa sıradan kavşak olur). Topolojide bu hücre düğüm değildir:
  her iki yol hücreden düz geçer, iki ayrı kenar zincirine aittir ve araçlar birbirini hiç beklemez.
  Silgi üst geçidi kaldırır (otoyol kalır, köprü geri gelir); bir ucunun sokağı silinirse üst geçit de
  kalkar. Otoyol hücreleri artık yalnızca kavşakta ya da şehir dışı kapısının yanında düğümdür.
- **İpucu:** Bir kavşak kilitlenince ya da kuyruk 6 araca ulaşınca, oyuncunun ışığı ve ışıksız bir
  kavşağı varsa, oyun başına bir kez trafik ışığı önerilir.
- **Trafik ışığı** (`grid.signal`, `SIGNAL`): Talebe duyarlı ışık. Kuzey–güney ve doğu–batı yönleri
  sırayla yeşil yanar. Yeşil en az 4 sn sürer; o yönde düz giden kalmadıysa ve başkası bekliyorsa erken,
  en geç 14 sn sonra biter. Yeşil bittiğinde o yönde sola dönmeyi bekleyen varsa, kısa bir tümü-kırmızıdan
  sonra yalnızca dönen araçların geçtiği korumalı sola dönüş fazı gelir (2,5–7 sn). Fazlar arasında kutu boşalana kadar (en az 1,5 sn) her yön kırmızıdır.
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

## Denge

`npm run bench`, performans testinin yanında basit bir **denge botu** (`tests/perf/bot.ts`) çalıştırır. Bot
her 2 sn'de bir, kendi renginde iş yerine ulaşamayan evleri ve hiçbir evin ulaşamadığı iş yerlerini en
yakın uygun binaya bağlar (önce kuru yoldan, yoksa köprüyle), kalabalık bir kavşağa ışık koyar ve
ödülleri ihtiyaca göre seçer. Her ilçe, her modda aynı tohumla (11) en çok 1500 sn oynanır.

Son ölçüm (bot, insan oyuncudan zayıftır; süreler oyunun bittiği saniyedir):

| Mod    | En kısa        | En uzun        | Not                                         |
| ------ | -------------- | -------------- | ------------------------------------------- |
| Rahat  | 1500 (hepsi)   | 1500           | Oyun bitmez; skor 570–1940                  |
| Normal | 426 (Beşiktaş) | 897 (Beykoz)   | 12 ilçenin 9'u 530 sn'nin üstünde           |
| Zor    | 213 (Beykoz)   | 709 (Bakırköy) | Tek tohumla ölçüldüğü için dağılım geniştir |

Bu ölçümlere göre yapılan ayarlar: Normal modda taşma süresi 60 → 75 sn; başlangıç köprüsü 4 → 6
(köprüler üst geçitte de kullanılır); ilk mahalle ve her yeni rengin ilk evi iş yeriyle aynı kıyıda
kurulur; karşı kıyıda bina 2. haftadan önce çıkmaz; Bakırköy'de Ayamama Deresi biraz doğuya alındı.

## Şehir hayatı

- **Martılar** (`GameSession.gull`, `AMBIENCE`): İlk martı 30. saniyede, sonra 40–80 sn aralıklarla, oyun
  alanının yakınındaki açık suyun (dört yanı su olan hücreler) üstünde belirir, rastgele bir yönde 7 m/sn
  uçar ve 14 sn sonra gider. Uçarken en fazla üç kez öter (`gullCall`). Oyuncu ona dokunursa
  (`catchGull`) +2 yol parçası alır ve martı kaybolur. Rastgelelik ayrı bir tohumdan gelir; trafik
  simülasyonunu etkilemez. Açık suyu olmayan ilçede (Bağcılar) martı çıkmaz.
- **Kornalar:** Kilitlenme varken ya da en uzun kuyruk 8 araca ulaşınca bir "sıkışıklık" başlar. Her
  sıkışıklıkta en fazla 3 korna çalar, aralarında en az 7 sn olur. Trafik 15 sn sakin kalınca sayaç
  sıfırlanır. Böylece sesler hiçbir zaman sürekli çalmaz.
- **Metrobüs** (`Ambience`, `metrobusRoutes`): Yalnızca görseldir. 30 sn'de bir D-100 ya da O-1'in orta
  şeridinde harita dışından girip diğer uçtan çıkar (16 m/sn). Simülasyon zamanıyla ilerler, oyun
  duraklayınca durur; trafikle etkileşmez, tıpkı gerçek metrobüsün ayrı yolu gibi.
- Sesler (martı, korna, ödül) Web Audio ile sentezlenir; ses dosyası yoktur.

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
- **Rehberli öğretici:** Sabit Kadıköy haritasında 7 adım (bağla → ilk araba → diğer evler → geri
  al/sil → trafik ışığı → otoyol ve üst geçit → köprü). Son üç adım okunup geçilebilir; ışık adımı bir
  ışık konunca kendiliğinden ilerler. Hedef evler başlangıçta sabitlenir, şehir büyüse de değişmez. Haftalık ödül penceresi bir
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

- Katmanlar: zemin → yer adları → yollar → otoyol tabelaları → trafik katmanı → binalar → bina durumu →
  araçlar → trafik ışıkları → seçim → kilitlenme → önizleme → imleç.
- Her ilçenin kendi zemin/su/park tonu vardır (`District.palette` → `districtTheme`; yüksek kontrast
  teması etkilenmez). Su, kıyıya işaretli uzaklık alanından (hafif bulanıklaştırılmış) marching squares
  ile çizilir: açık kıyı bandı, su, açık denizde koyu bant ve seyrek nokta dokusu. Bu sayede kıyılar
  hücre basamağı yerine yumuşak eğri olur. Silik ızgara varsayılan olarak açıktır.
- Yer adları (BOĞAZ, HALİÇ, MARMARA DENİZİ, park adları) `placeLabels` ile yerleşir: adın tamamı kendi
  arazisinin üstüne ve başka bir adla çakışmadan sığmalıdır. Oynanabilir alanın içi tercih edilir, ama ad
  alanın 5 hücre dışına da konabilir (orada soluk görünür); böylece deniz alan oraya ulaşmadan adlanır.
  Dar dereler (`river`) küçük yazılır ve derenin yerel yönüne (çevredeki su hücrelerinin ana ekseni)
  döndürülür.
- **Mevsimler:** Her hafta mevsim değişir (`seasonOf`: ilkbahar → yaz → sonbahar → kış). `districtTheme`
  ilçe paletini mevsime göre karıştırır (kışın karlı zemin, sonbaharda turuncu parklar); harita hafta
  başında yeniden boyanır, haftalık ödül penceresi mevsimi gösterir. Yüksek kontrast teması değişmez.
- Otoyollar beyaz kenar çizgili ve kesik orta çizgili çizilir; harita kenarındaki kapılarda harita
  dışına doğru devam eder. Otoyol adı (D-100, O-1 …) köprü olmayan düz bir kısımda tabela olarak durur:
  otoyol yeşil, devlet yolu mavi, cadde koyu. Üst geçitler gölgeli küçük bir köprü olarak çizilir.
  Trafik ışıkları her kolda bir lamba gösterir (yeşil / sarı / kırmızı; korumalı sola dönüşte beyaz nokta).
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
