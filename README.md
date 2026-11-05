# Aynalı Prompter

Gün Teknik için aynalı prompter uygulaması. Adres: **https://gokaysegun.github.io/Prompter/**

- `index.html`: metin, ayarlar ve prompter ekranı
- `kontrol.html`: telefondan kumanda ve operatör paneli (canlı metin, dokunarak atlama, canlı düzenleme)

## Özellikler
- Hece bazlı akış (Türkçe: hece = sesli harf), noktalama durakları, harf harf solma
- Okuma çizgisi satırın altında satırla birlikte çıkar, son heceye yakın alt satıra geçer
- Akış modları: sabit hız, ses kapısı (konuşunca akar), sesle takip (tr-TR konuşma tanıma)
- Metin işaretleri: `# Bölüm`, `// not`, `**vurgu**`, `[DUR 2]`, `/` (nefes)
- Metin kütüphanesi, otomatik sürüm geçmişi, kaldığı yerden devam, çekim geçmişi ve gerçek hız istatistiği
- Hedef süre → gereken hız, kişisel hız ölçümü
- Ekran tipi profilleri (telefon/tablet/bilgisayar/monitör), ayna, döndürme, görünür alan kırpma
- Klavye / fare / PS kontrolcü tuş atama, analog çubukla hız veya sarma, basılı tutunca hızlı ileri/geri
- Ayarlar hesapla tüm cihazlarda eşitlenir; PWA olarak kurulur, çevrimdışı açılır

## Altyapı
Supabase “Gün Teknik” projesi, ERP'den ayrı **`prompter`** şeması (tablolar `scripts`, `script_versions`, `settings`, `takes`; satır bazlı erişim yalnızca sahibine).
Anlık kumanda: Supabase Realtime özel kanal `prompter:<kullanıcı-id>`. Oturum ERP'den ayrı anahtarda (`prompter-auth`) tutulur.
Şema tanımı: `sql/schema.sql`.

Derleme adımı yoktur; dosyalar doğrudan GitHub Pages'ten sunulur. Yeni sürüm çıkarken `sw.js` içindeki `VERSION` artırılır.
