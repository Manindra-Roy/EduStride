# 🚀 Deployment Guide: EduStride.in

This guide outlines how to deploy the **EduStride** platform using PaaS (Platform-as-a-Service): **Render** for the backend Node/Express server and **Vercel** for the frontend React/Vite application.

---

## 📦 Part 1: Backend Deployment on Render

Render will host the Express backend, keeping the WebSocket server and background cron automation jobs running persistently.

### Steps:
1. Log in to **[Render](https://render.com/)**.
2. Click **New +** and select **Web Service**.
3. Connect your GitHub repository (`EduStride`).
4. Configure the Web Service settings:
   - **Name**: `edustride-backend` (or similar)
   - **Environment**: `Node`
   - **Region**: Select a region close to your target audience (e.g., Singapore for India).
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: Select the **Free** tier (or **Starter** for better performance/no spin-downs).
5. Click **Advanced** and add the following **Environment Variables**:
   - `NODE_ENV` = `production`
   - `MONGO_URI` = *(Your MongoDB Atlas Connection URI)*
   - `JWT_SECRET` = *(Any long random string for securing tokens)*
   - `EMAIL_HOST` = `smtp.gmail.com`
   - `EMAIL_PORT` = `587`
   - `EMAIL_USER` = *(Your Gmail address, e.g., name@gmail.com)*
   - `EMAIL_PASS` = *(Your Gmail App Password generated from Google Account settings)*
   - `CLOUDINARY_CLOUD_NAME` = *(Your Cloudinary cloud name)*
   - `CLOUDINARY_API_KEY` = *(Your Cloudinary API key)*
   - `CLOUDINARY_API_SECRET` = *(Your Cloudinary API secret)*
6. Click **Create Web Service**.
7. Once deployed, note down the backend service URL (e.g., `https://edustride-backend.onrender.com`).

---

## 🎨 Part 2: Frontend Deployment on Vercel

Vercel will build and serve your static React application, routing requests to your Render backend.

### Steps:
1. Log in to **[Vercel](https://vercel.com/)**.
2. Click **Add New** > **Project**.
3. Import your GitHub repository (`EduStride`).
4. Configure the Project settings:
   - **Framework Preset**: `Vite` (automatically detected)
   - **Root Directory**: Click *Edit* and select **`frontend`**.
   - **Build & Development Settings**: Keep defaults (Build: `npm run build`, Output: `dist`, Install: `npm install`).
5. Under **Environment Variables**, add:
   - `VITE_API_URL` = *(Your Render backend URL from Part 1, e.g., `https://edustride-backend.onrender.com`)* **(Make sure there is NO trailing slash `/` at the end)**.
6. Click **Deploy**.

---

## 🌐 Part 3: Connecting Your Domain (`EduStride.in`)

Now, connect your purchased domain `EduStride.in` to your Vercel deployment.

### Steps:
1. In the Vercel dashboard, go to your deployed project page.
2. Navigate to **Settings** > **Domains**.
3. Enter `edustride.in` and click **Add**.
   - Vercel will recommend adding both `edustride.in` and `www.edustride.in` (redirecting one to the other). Choose **Add** for both.
4. Vercel will generate DNS configuration values:
   - For `edustride.in` (Apex domain): It will show an **A Record** pointing to a Vercel IP (e.g. `76.76.21.21`).
   - For `www.edustride.in` (CNAME record): It will show a CNAME pointing to `cname.vercel-dns.com`.
5. Log in to the registrar where you purchased `EduStride.in` (GoDaddy, Namecheap, Hostinger, etc.).
6. Open the **DNS Manager** or **DNS Settings** for your domain.
7. Add/update the records shown by Vercel:
   - **Type**: `A` | **Name**: `@` | **Value**: `76.76.21.21` (Vercel IP)
   - **Type**: `CNAME` | **Name**: `www` | **Value**: `cname.vercel-dns.com.`
8. Save settings. It may take a few minutes (or up to 24 hours) for DNS propagation. Vercel will automatically provision a free Let's Encrypt SSL certificate once propagation completes.

---

## 🧪 Part 4: Post-Deployment Verification

1. Visit **`https://edustride.in`** in your browser.
2. Confirm the dashboard page loads correctly.
3. Open the browser's developer console (F12) to ensure there are no CORS or network connection errors.
4. Try logging in using your credentials.
5. Go to the **Class Chat** panel and send a message. Verify that messages deliver and update instantly (which confirms the WebSockets are connected to Render).
