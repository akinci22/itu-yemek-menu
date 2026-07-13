# İTÜ Yemek Menü Arşivi

İTÜ yemekhane menüsünü **her gün otomatik yakalayıp** saklayan küçük bir depo.
"İTÜ Yemek & Kalori" uygulaması bu arşivi okuyarak geçmiş/gelecek günlerin
menüsünü gösterir.

## Neden var?

İTÜ, menüyü yalnızca **o anki güncel öğün** için yayınlıyor — geçmiş/gelecek
günler için hiçbir açık kaynak yok. Tek çözüm: her gün "bugünü" bir kez yakalayıp
biriktirmek. Bu depo tam olarak bunu yapar; zamanla gerçek, gezilebilir bir
menü geçmişi oluşur.

## Nasıl çalışır?

- `capture.mjs` — ituyemekmetre'nin JSON'undan (öğün + yemek + kalori) ve İTÜ
  sayfasından (yemek id → resmi besin değerleri) o günün menüsünü çeker,
  `docs/menu/<YYYY-MM-DD>-<lunch|dinner>.json` olarak yazar.
- `.github/workflows/capture.yml` — GitHub Actions, her gün öğle (13:30) ve akşam
  (20:00, İstanbul) çalışır, değişiklik varsa commit'ler.
- `docs/` klasörü **GitHub Pages** ile yayınlanır → uygulama
  `https://<kullanıcı>.github.io/itu-yemek-menu/menu/<tarih>-<öğün>.json`'u okur.

## Kurulum (bir kez)

1. Bu depo **public** olmalı (Actions + Pages ücretsiz çalışsın diye).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   Branch: `main`, klasör: `/docs`, **Save**.
3. **Settings → Actions → General → Workflow permissions: Read and write**, kaydet.
4. **Actions** sekmesi → "Capture İTÜ menu" → **Run workflow** ile ilk kaydı
   hemen alabilirsin (yoksa bir sonraki öğün saatinde otomatik alır).

Sonrası tamamen otomatik — hiçbir şey yapman gerekmez.

## Veri biçimi

```json
{
  "date": "2026-07-13",
  "meal": "dinner",
  "label": "13 Temmuz Akşam Yemeği",
  "capturedAt": "2026-07-13T18:58:05.280Z",
  "dishes": [
    { "id": 24, "name": "ALACA ÇORBASI", "category": "soup",
      "kcal": 178.2, "protein": 4.9, "carb": 17, "fat": 8.6, "vegetarian": false }
  ]
}
```

Kategoriler: `soup` (çorba), `main` (ana yemek), `side` (yan yemek), `extra`
(tatlı/salata/meyve/içecek).
