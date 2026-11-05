# GG Prompter

Aynalı prompter uygulaması. Adres: **https://gokaysegun.github.io/Prompter/**

Tek uygulama, üç rol (sağ üstten seçilir; Cihazlar bölümünden uzaktan da atanır):
- **Prompter**: metin, kütüphane, tüm ayarlar, başlatma ve canlı izleme. Ses kapısı / sesle takip kararını bu cihazın mikrofonu verir.
- **Ekran**: camın altındaki aynalı görüntü. Beklerken görünür alan çerçevesiyle kalibrasyon gösterir; ⚙ ile kendi ayarları.
- **Kumanda**: dokunmatik alan + yön tuşlu kumanda ve tüm ayarlara erişen ayar paneli.

Bir cihaz Prompter olunca önceki Prompter Kumanda'ya geçer. Ekran yoksa Prompter kendi ekranında akıtır.
`kontrol.html` eski QR bağlantılarını `index.html?role=kumanda` adresine yönlendirir.

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

## Bağlantı
Cihazlar **aynı WiFi** ağında olmalıdır. Akış, kumanda, ses, ayar ve metin trafiği WebRTC veri kanallarıyla doğrudan cihazdan cihaza gider (ICE sunucusu yok → yalnızca yerel ağ). Supabase yalnızca giriş, kayıt ve cihazların ilk tanışması (presence + el sıkışma) için kullanılır; WiFi bağlantısı kurulduktan sonra internet kopsa da akış sürer.

## Altyapı
Supabase “Gün Teknik” projesi, ERP'den ayrı **`prompter`** şeması (tablolar `scripts`, `script_versions`, `settings`, `takes`; satır bazlı erişim yalnızca sahibine).
Anlık kumanda: Supabase Realtime özel kanal `prompter:<kullanıcı-id>`. Oturum ERP'den ayrı anahtarda (`prompter-auth`) tutulur.
Şema tanımı: `sql/schema.sql`.

Derleme adımı yoktur; dosyalar doğrudan GitHub Pages'ten sunulur. Yeni sürüm çıkarken `sw.js` içindeki `VERSION` artırılır.
