import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "iad" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "iad", sizeMB: 500 });
  const api = service("api", {
    source: github("alishasaiyed1996-dev/marine", { branch: "master", checkSuites: false, rootDirectory: "backend" }),
    build: "npm run build",
    start: "npm run start",
    preDeploy: "npx prisma migrate deploy",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { "iad": 1 },
    env: { ADMIN_EMAIL: preserve(), ADMIN_PASSWORD: preserve(), ADMIN_URL: preserve(), CLOUDINARY_URL: preserve(), COMPANY_EMAIL: preserve(), COMPANY_NAME: preserve(), COMPANY_PHONE: preserve(), CORS_ORIGIN: preserve(), CSRF_SECRET: preserve(), DATABASE_URL: "${{Postgres.DATABASE_URL}}", DEFAULT_COUNTRY: preserve(), DEFAULT_CURRENCY: preserve(), DEFAULT_SHIPPING_COST: preserve(), DEFAULT_TAX_RATE: preserve(), DIRECT_URL: "${{Postgres.DATABASE_URL}}", EBAY_CLIENT_ID: preserve(), EBAY_CLIENT_SECRET: preserve(), EBAY_ENV: preserve(), EBAY_FULFILLMENT_POLICY_ID: preserve(), EBAY_MERCHANT_LOCATION_KEY: preserve(), EBAY_PAYMENT_POLICY_ID: preserve(), EBAY_PUBLIC_ENDPOINT: preserve(), EBAY_REFRESH_TOKEN: preserve(), EBAY_RETURN_POLICY_ID: preserve(), EBAY_VERIFICATION_TOKEN: preserve(), EMAIL_FROM: preserve(), EMERGENCY_EMAIL: preserve(), FRONTEND_URL: preserve(), JWT_EXPIRES_IN: preserve(), JWT_SECRET: preserve(), LOG_LEVEL: preserve(), NODE_ENV: preserve(), NODE_VERSION: preserve(), PAYPAL_CLIENT_ID: preserve(), PAYPAL_CLIENT_SECRET: preserve(), PAYPAL_MODE: preserve(), PAYPAL_WEBHOOK_ID: preserve(), PORT: preserve(), REFRESH_TOKEN_EXPIRES_IN: preserve(), RESEND_API_KEY: preserve(), RFQ_EMAIL: preserve(), SALES_EMAIL: preserve(), SMTP_HOST: preserve(), SMTP_PASS: preserve(), SMTP_PORT: preserve(), SMTP_SECURE: preserve(), SMTP_USER: preserve(), WHATSAPP_NUMBER: preserve() },
  });
  const marine = service("marine", {
    source: github("alishasaiyed1996-dev/marine", { branch: "master", checkSuites: false }),
    build: "npm run build",
    start: "npm start",
    healthcheck: "/health/live",
    healthcheckTimeout: 60,
    replicas: { "iad": 1 },
    env: { NODE_ENV: preserve(), NODE_VERSION: preserve(), VITE_API_URL: preserve(), VITE_APP_VERSION: preserve(), VITE_DEFAULT_THEME: preserve(), VITE_FRONTEND_URL: preserve(), VITE_SITE_URL: preserve() },
  });

  return project("sparkling-clarity", {
    variables: { managed: true },
    resources: [Postgres, api, marine, postgresVolume],
  });
});
