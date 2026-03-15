# Glibran API Mesh & Frontend Client 🖥️

This directory hosts the complete Frontend client that orchestrates background workflows, presents user actions displays, captures directly signed file responses uploading to secure triggers handling monetization payouts routing safely.

---

## ⚡ Tech Stack Details

*   **Next.js 16** (App Directory + React Server Components)
*   **Tailwind CSS v4** + **Shadcn UI** components setups inside `/src`.
*   **NextAuth Hooks**: Setup endpoints using Auth configurations mapped cleanly.
*   **Prisma v7**: Structured relational pools targeting lightweight triggers fast responses safely.

## 🛠️ Environment Variables Configuration (`/.env`)

Make sure you copy setting configurations properly set endpoints locally:
*   `DATABASE_URL` 
*   `NEXTAUTH_SECRET` / `NEXTAUTH_URL`
*   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
*   `MAYAR_WEBHOOK_SECRET` / `MAYAR_API_KEY`
*   `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`

---

## 🏃 Getting Started

First, install dependencies and run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the live view render.

## 📁 Key Routes Layout Index
-   📂 `src/app/` - Base App Router entry interfaces.
-   📂 `src/lib/` - Shared core singletons setup handlers (**Prisma, next-auth, AWS S3 buckets mappings**).
-   📂 `src/components/` - Common UI widgets helpers triggers layouts.

---
*Back to dashboard root index file [../README.md](../README.md).*
