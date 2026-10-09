# نظام اختبار آلي متعدد الشخصيات (Automated Multi-Persona Test Harness)

## أول مرة بس
npm install
npm run setup

## تجربة من غير n8n
npm run test-once -- https://any-website.com

## التشغيل مع n8n (شاشتين سودا مفتوحين)
الشاشة 1:  npm run server
الشاشة 2:  npx n8n
بعدين: استوردي workflow.json في n8n ودوسي Execute workflow
التقرير: http://127.0.0.1:3456/report

## موقع التجربة (فيه مشاكل متعمّدة)
npm run demo-site              (النسخة البايظة)
node demo-site/serve.js --fixed (النسخة المتصلحة)
وتختبريه على: http://127.0.0.1:4321

## صفحات بعد تسجيل الدخول (اختياري)
node save-login.js https://the-site.com/sign-in
وبعدين في config.json خلي "useSavedLogin": true
ملف auth.json سري، ماتبعتيهوش لحد.
