# MallPay — نظام مواعيد التسديد للمولات

واجهة عربية RTL مستوحاة من مرجع MallPay، مبنية على Next.js 15 وPrisma وPostgreSQL. المشروع بداية تشغيل فعلية قابلة للتوسعة، وليست واجهة HTML ثابتة. لا تنشره للعامة قبل إكمال قائمة التحقق أدناه.

## المتطلبات
- Node.js 22.23.2 (إصدار المشروع مثبت في `.nvmrc`)
- npm 10.9.2 (مثبت في `package.json`)
- PostgreSQL (محلي أو Neon)
- npm

## تشغيل محلي
1. فك الضغط وافتح مجلد المشروع في Terminal.
2. نفّذ `npm ci`.
3. انسخ `.env.example` إلى `.env` واملأ `DATABASE_URL` و`DIRECT_URL`. ولّد `AUTH_SECRET` عشوائياً، مثلاً `openssl rand -base64 32`.
4. نفّذ `npm run db:generate`.
5. طبّق migrations الموجودة: `npm run db:migrate`. في التطوير استخدم `npm run db:dev -- --name <short-name>` بعد تعديل schema.
6. (اختياري، للتطوير فقط) أضف بيانات تجريبية: `ALLOW_DEMO_SEED=true npm run db:seed`. الأمر يرفض العمل في الإنتاج.
7. أنشئ المدير بكلمة مرور تدخلها بنفسك: `npm run admin:create`.
8. شغّل `npm run dev` وافتح `http://localhost:3000`.

## قاعدة بيانات Neon
أنشئ PostgreSQL project على Neon. ضع رابط الاتصال المناسب للتطبيق في `DATABASE_URL`، والرابط المباشر غير المجمع في `DIRECT_URL` للمهاجرات. لا ترفع `.env` إلى Git.

## الفحص والبناء
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run db:validate`
- `npm run db:migrate` بعد نشر migrations إلى المستودع
- `npm run db:status`
- `npm run preflight:production` بعد ضبط متغيرات الإنتاج؛ يفحص HTTPS والأسرار واتصال PostgreSQL وحالة جميع migrations دون طباعة قيم الأسرار.
- افحص `GET /api/health` من أداة المراقبة؛ يعيد `503` عند تعذر اتصال PostgreSQL.

## Vercel
ارفع المشروع إلى Git، استورده في Vercel، وأضف متغيرات الإنتاج من `.env.example` إلى إعدادات Vercel Secrets، بما فيها `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `APP_URL`, `NOTIFICATION_CRON_SECRET`, مفاتيح Meta وResend. لا تضع القيم السرية في Git أو داخل ملف ZIP. نفّذ `npm run db:migrate` في خطوة نشر آمنة، ثم `npm run preflight:production` قبل توجيه المستخدمين إلى النسخة الجديدة. لا تستخدم بيانات seed التجريبية في الإنتاج.

## WhatsApp والبريد
عامل الإرسال يدعم WhatsApp عبر Meta Graph API والبريد الصادر عبر Resend API، ويحتاج جدولة موثوقة لـ `POST /api/internal/notifications/dispatch` مع `NOTIFICATION_CRON_SECRET`. اضبط `WHATSAPP_ACCESS_TOKEN` و`WHATSAPP_PHONE_NUMBER_ID`. الرسائل الحرة قد لا تُقبل خارج نافذة خدمة العملاء؛ عند الحاجة أنشئ قالب Meta معتمداً يحتوي متغير body واحداً `{{1}}` ثم اضبط `WHATSAPP_TEMPLATE_NAME` و`WHATSAPP_TEMPLATE_LANGUAGE`.

اضبط `EMAIL_API_KEY` و`EMAIL_FROM` بعد توثيق نطاق الإرسال في Resend. إشعار الطلب العام يُرسل إلى المدراء الفعالين، وتأكيد الموعد وإيصال الدفعة يذهبان إلى بريد الشركة إن كان مسجلاً. يوجد صندوق إشعارات داخل اللوحة. رسائل البريد غير المهيأة تبقى في قائمة الإرسال ولا تُحذف.

استقبل حالات SENT/DELIVERED/READ/FAILED عبر `${APP_URL}/api/internal/whatsapp/webhook`. اضبط `WHATSAPP_WEBHOOK_VERIFY_TOKEN` للتحقق الأولي و`WHATSAPP_APP_SECRET` للتحقق من توقيع Meta على كل POST. إعداد Meta وResend الفعليين يحتاجان حساباتك ومفاتيحك ولم يُختبرا هنا.

## أمان مهم
- الجلسة موقعة بمفتاح فريد وتُخزن في HttpOnly cookie مع SameSite=Lax؛ اضبط HTTPS في الإنتاج.
- تغييرات الإدارة وتسجيل الدخول والخروج ترفض الطلبات من مصدر آخر، وتتحقق واجهات JSON من نوع المحتوى والحجم.
- الاستجابات تضيف CSP ورؤوس حماية المتصفح؛ استخدم HTTPS دائماً، وتأكد من توافق سياسة CSP إذا أضيفت موارد خارجية.
- كلمات المرور مخزنة كـ bcrypt hash ولا توجد كلمة مرور افتراضية.
- أنشئ المدير باستخدام `npm run admin:create`.
- توجد حدود محاولات مشتركة بين نسخ التطبيق ومخزنة في PostgreSQL لتسجيل الدخول والطلبات العامة؛ طبّق migration الجديدة قبل تشغيلها.
- لا يثق تحديد المحاولات برؤوس IP افتراضياً. اضبط `RATE_LIMIT_TRUSTED_IP_HEADER=x-real-ip` فقط إذا كان وسيط الدخول الموثوق لديك يستبدل هذا الرأس ولا يمرر قيمة المرسل؛ من دون ذلك تبقى حدود البريد والرابط العام فعالة.
- اضبط `APP_URL` على أصل الموقع العام باستخدام HTTPS في الإنتاج. لا تستخدم قيمة localhost عند النشر.
- قبل الإنتاج أضف مراقبة وتنبيهات وسياسة نسخ احتياطي، ونفّذ اختبار نشر وتزامن على قاعدة اختبار منفصلة.
- لا يعتبر preflight بديلاً عن توثيق نطاق Resend، اعتماد قالب Meta، اختبار استعادة النسخة الاحتياطية، أو مراجعة إعداد HTTPS/DNS في منصة الاستضافة.
- لا تُظهر company token الخام إلا عند إنشائه؛ قاعدة البيانات تخزن hash فقط. لا تشارك روابط الشركات في سجلات عامة.

## حالة الوظائف
الموجود: لوحة عربية RTL، تسجيل دخول المدير، طلب عام برابط شركة أو رابط مشترك لا يكشف قائمة الشركات ويطلب من المندوب كتابة اسم الشركة واختيار المول الفعّال، حتى لو لم تكن الشركة مسجلة؛ يظهر الاسم والمول مع الطلب دون إضافة الشركة تلقائياً، قائمة طلبات بصفحات وتصفية، جدولة/إعادة جدولة/رفض بتوقيت بغداد، تسجيل دفعات جزئية دقيقة ومنع التجاوز والتكرار، سجلات تدقيق، تصدير CSV، وتحديد محاولات في PostgreSQL. يمكن تعديل الشركات والمولات وإيقافها دون حذف التاريخ؛ الإيقاف يبطل روابط الشركة. التقويم يسمح بإعادة جدولة المواعيد المرتبطة بالطلبات. إشعارات الإدارة داخل اللوحة، وإشعارات WhatsApp والبريد تُرسل من العامل بعد ضبط حسابات Meta وResend.

## فحوصات النسخة
يتم التحقق آلياً في GitHub Actions عند push أو pull request، ويمكن تشغيله يدوياً من تبويب Actions، عبر تثبيت نظيف وفحص TypeScript وESLint والاختبارات والبناء وتطبيق migrations على PostgreSQL 16 مؤقت. الاختبارات التي تتطلب قاعدة الاختبار تُشغّل عند ضبط `TEST_DATABASE_URL`؛ يفشل إعداد Vitest في GitHub Actions إن غاب المتغير؛ لم يُختبر إرسال WhatsApp بحساب Meta.

اختبارات `src/app/api/routes.integration.test.ts` تمارس المسارات على PostgreSQL: الدخول والمصدر، تكرار الطلب، الطلب العام، صندوق الإشعارات، إيقاف الشركة/المول، والتزامن لمنع تجاوز الرصيد. `src/lib/auth.test.ts` يفحص جلسات المدير. CI يمرر `TEST_DATABASE_URL` إلى PostgreSQL المؤقت ويشغّل هذه الاختبارات؛ إعداد Vitest يفشل فوراً داخل GitHub Actions إذا غاب المتغير، حتى لا تنجح الفحوصات مع تخطي اختبارات قاعدة البيانات بصمت. صلاحيات GitHub token في workflow مقتصرة على قراءة المستودع.

نتيجة `npm audit --omit=dev` السابقة هي صفر ثغرات في اعتماديات الإنتاج. التدقيق الكامل يرصد 5 عقد عالية متأثرة في مسار تطويري واحد، وليست خمس ثغرات مستقلة: `eslint-config-next` ← `@next/eslint-plugin-next` ← `fast-glob` ← `micromatch` ← `braces`. الاستشارة [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (CVE-2026-93687) تعتبر `braces <=3.0.3` متأثراً؛ سجل npm ما زال يعرض `3.0.3` كأحدث إصدار ولا يسجل إصداراً مُصلحاً. لذلك لا يوجد تحديث آمن لتثبيته الآن. لم نستخدم `npm audit fix --force` لأنه يقترح تخفيض إعداد ESLint الخاص بـNext.js إلى الإصدار 14 مع بقاء التطبيق على Next.js 15. لم نعد تشغيل التدقيق الكامل في بيئة العمل الحالية لغياب npm.

## Public representative request flow

Use **Dashboard → Company Links** to issue a shared public link. The representative selects an active mall, types the company name, and submits their phone number and requested amount; the link never reveals the company list. If the name matches a company in that mall, the request is linked to it. Otherwise the request keeps the typed company name and selected mall without adding a company record. The shared link expires after 90 days; rotating it immediately disables the previous shared link. Company-specific links remain available as an optional alternative. New links are shown once, with an optional QR code. The request is stored as pending, and an admin schedules the appointment from **Dashboard → Requests**.

The schedule API stores the selected date/time, creates an appointment record, and queues WhatsApp and email notifications when recipient details exist. Delivery is **not active until Meta/Resend credentials, an approved WhatsApp template, the scheduler, and webhook settings are configured and tested**. Do not treat a queued notification as delivered.

`PaymentRequest.dueAt` is nullable until the administrator schedules a date. Apply a new Prisma migration after changing the schema in an existing database.


## WhatsApp notification worker

Approved appointment notifications are queued in the database. Configure `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`, and `NOTIFICATION_CRON_SECRET`, then invoke `POST /api/internal/notifications/dispatch` from a trusted scheduler with `Authorization: Bearer <NOTIFICATION_CRON_SECRET>`. For an approved Meta template, set `WHATSAPP_TEMPLATE_NAME` and `WHATSAPP_TEMPLATE_LANGUAGE`; the template must have one body text parameter. Outbound email uses Resend: set `EMAIL_API_KEY` and a verified-domain `EMAIL_FROM`. The same dispatch endpoint sends both channels and stores provider IDs. Configure Meta's callback at `/api/internal/whatsapp/webhook`, verify using `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and sign POST requests with `WHATSAPP_APP_SECRET`; the endpoint updates WhatsApp delivery status. SENT means accepted by the provider API, not confirmed delivered.

## Schema updates

For a new database, set `DATABASE_URL` and apply the checked-in migrations with `npm run db:migrate`. For a schema change during development, run `npm run db:dev -- --name <short-name>`, review the generated migration, and commit it. In production, run `npm run db:migrate` before deploying code that depends on the schema change.


### Notification worker concurrency

The dispatch endpoint atomically claims queued notifications by moving them to `PROCESSING` before calling WhatsApp. Claims still in that state for more than five minutes are moved to `FAILED` with a reconciliation warning; verify provider state before manually retrying because it may have accepted a message before a worker crash. Delivery confirmation is distinct from the API accepting a send request and requires a correctly configured Meta webhook.
