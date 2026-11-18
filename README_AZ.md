# DARK CITY — Rank Shop + Admin Approval + MTA:SA Bridge

Bu paket əvvəlki `dark-city-website.html` layihəsinin neon-bənövşəyi görünüşünü saxlayır və ona manual çek yoxlaması ilə rütbə satışı əlavə edir.

## Funksiyalar
- Yenilənmiş Dark City ana səhifəsi: istifadəçinin göndərdiyi neon referens dizaynı və orijinal loqo
- Mobil və planşet üçün ayrıca responsive naviqasiya, hero, status paneli və kart düzülüşü
- `public/assets/` daxilində loqo, hero fonu və 3 feature şəkli
- Əsas sayt və mobil uyğun dizayn (`public/index.html`)
- Rütbə mağazası və sifariş formu
- JPG/PNG/WEBP çek yükləmə (maksimum 5 MB)
- Sifariş ID-si ilə status yoxlama
- Admin login və sifariş paneli (`/admin`)
- Admin çekə baxır, təsdiqləyir və ya səbəb yazaraq rədd edir
- Təsdiqdən sonra backend MTA üçün gözləyən grant yaradır
- MTA resource API-dən grant-ları götürür, MTA hesabını ACL qrupuna əlavə edir və ACK göndərir

## 1. Saytı lokal işə salmaq

Node.js 20+ quraşdırın. Bu qovluqda:

```bash
cp .env.example .env
npm install
```

`.env` faylında bunları mütləq dəyişin:
- `SESSION_SECRET` — uzun, təsadüfi gizli açar
- `ADMIN_USERNAME` və `ADMIN_PASSWORD` — admin giriş məlumatları
- `MTA_API_TOKEN` — ayrıca uzun təsadüfi token
- `PAYMENT_BANK`, `PAYMENT_CARD`, `PAYMENT_RECIPIENT`, `PAYMENT_NOTE` — real ödəniş məlumatları

Sonra:

```bash
npm start
```

Sayt: `http://localhost:3000`
Admin: `http://localhost:3000/admin`

## 2. Rütbə və qiymətləri dəyişmək

`config.js` daxilində `ranks` siyahısını redaktə edin. `id`, `price`, `name` və `aclGroup` sahələrini uyğunlaşdırın. `aclGroup` MTA serverinin `acl.xml` faylında mövcud qrup adı ilə eyni olmalıdır.

Rütbə siyahısı hazırda boş saxlanılıb. Sənin göndərəcəyin real rütbə adları, qiymətləri, müddətləri və ACL qrupları əlavə olunandan sonra mağaza aktivləşəcək.

## 3. MTA:SA resource quraşdırılması

1. `mta-resource` qovluğunu serverin `mods/deathmatch/resources/` qovluğuna köçürün (qovluğun adı məsələn `darkcity_rank_shop` olsun).
2. `mta-resource/config.lua` faylında `apiBase` dəyərini saytın ictimai HTTPS domeninə yazın.
3. `apiToken` dəyərini backend `.env` faylındakı `MTA_API_TOKEN` ilə eyni edin.
4. `rankGroups` dəyərlərini MTA `acl.xml` içindəki qruplarla eyniləşdirin.
5. Server konsolunda `refresh` və `start darkcity_rank_shop` icra edin.

MTA serverinin sayt backend-inə HTTPS çıxışı olmalıdır. API tokeni heç vaxt sayta, client.lua-ya və ya oyunçuya göstərməyin.

## 4. Təsdiq axını

Oyunçu username + rütbə + çek göndərir → admin çekin həqiqiliyini bank hesabından yoxlayır → admin təsdiqləyir → grant DB-də yaranır → MTA resource grant-ı götürür → hesabı ACL qrupuna əlavə edir → grant tamamlanmış kimi işarələnir.

Grant MTA tərəfindən tətbiq olunana qədər backend-də gözləyir. Oyunçunun MTA hesabı tapılmırsa və ya ACL qrupu yoxdursa, grant silinmir; səbəb server logunda görünür və düzəlişdən sonra yenidən yoxlanır.

## Vacib inteqrasiya qeydi

MTA resource hazırda MTA-nın daxili account/ACL sistemindən istifadə edir. Əgər Dark City serverində login/account sistemi xüsusi MySQL resource-u ilə işləyirsə, `mta-resource/server.lua` daxilindəki `applyGrant()` funksiyasını həmin sistemə uyğunlaşdırmaq lazımdır. Mövcud `acl.xml`, login resource-u və account cədvəlinin sxemi olmadan canlı serverdə düzgün qrup təyinatını 100% təsdiqləmək mümkün deyil.

## Production təhlükəsizliyi
- Saytı yalnız HTTPS arxasında yayımlayın.
- `.env`, `storage/`, çek şəkilləri və SQLite DB-ni public web qovluğundan kənarda saxlayın.
- `storage/` qovluğunu davamlı diskə (persistent volume) bağlayın; müvəqqəti fayl sistemində deploy etməyin.
- `.env` və MTA API tokenini git-ə commit etməyin.
- Admin parolunu güclü edin; hostingdə persistent session store (Redis/SQLite session store) istifadə edin.
- Bank hesabında real ödəniş görünmədən heç bir çeki təsdiqləməyin.
- Bu starterdə sifariş statusu lookup ID əsasında açıqdır; ictimai istifadəyə çıxmazdan əvvəl username + sifariş üçün əlavə təsdiqləmə/OTP və ya hesab giriş inteqrasiyası əlavə etmək tövsiyə olunur.


## Ana səhifə vizual yenilənməsi
- Göndərdiyiniz Dark City loqosu `public/assets/dark-city-logo.jpg` kimi istifadə olunur.
- Hero fonunda neon şəhər və avtomobil fotosu saxlanılıb; sol tərəfdə mətn üçün tünd gradient verilib.
- Avtomobilin iki təkərinin üzərində CSS konik-gradient animasiyası ilə fırlanma effekti yaradılıb.
- Mobil menyu, hero ölçüləri, status kartları və mağaza bölməsi kiçik ekranlara uyğunlaşdırılıb.
- IP ünvanına klikləməklə kopyalama funksiyası əlavə edilib.


## Referens dizaynın HTML/CSS ilə yenidən qurulması
- Ana səhifənin menyusu, başlığı, düymələri, server status paneli və üç əsas kartı ayrıca HTML/CSS elementləridir; bütöv referens ekran görüntüsü fon kimi istifadə edilmir.
- Şəhər və avtomobil üçün ayrıca kinematik səhnə şəkli, kartlar üçün ayrıca şəkillər istifadə olunur.
- Kartlarda hover zamanı yumşaq yuxarı qalxma və neon kölgə effekti var.
- Avtomobil təkərləri üçün CSS fırlanma overlay animasiyası əlavə edilib.
- Mobil görünüşdə menyu, hero, server paneli və kartlar ayrıca uyğunlaşdırılır.
- Rütbələr istifadəçinin təqdim edəcəyi siyahı gələnədək boş saxlanılıb.


## Son vizual düzəliş
- Hero üçün şəhər və avtomobil fotosunun yalnız təmiz foto hissəsi istifadə olunur; ekran görüntüsünün menyu, mətn və kartları fon kimi qoyulmur.
- Avtomobilin üstünə əlavə edilmiş saxta təkər overlay-ləri və fırlanma animasiyası tam silinib.
- Başlıq, düymələr, server paneli və kartlar ayrıca HTML/CSS elementləri olaraq qalır.
- Ana səhifə və bölmələrin mətnləri daha qısa, təbii Azərbaycan dilində yenilənib.
