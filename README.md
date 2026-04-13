# IntegrationHub

Modern web application for managing cloud application integrations and backups.

## Tech Stack

### Frontend
- **React 18** - UI library
- **Vite 5** - Build tool and dev server
- **Ant Design 5** - UI component library
- **React Router 6** - Client-side routing
- **Zustand** - State management
- **Axios** - HTTP client
- **Day.js** - Date/time handling

### Deployment
- **Docker** - Containerization
- **Nginx** - Production web server
- **Docker Compose** - Multi-container orchestration

## Project Structure

```
integration app/
├── frontend/
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   │   ├── Sidebar.jsx
│   │   │   ├── Topbar.jsx
│   │   │   └── ProtectedRoute.jsx
│   │   ├── pages/           # Page components
│   │   │   ├── Login.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   └── Backup.jsx
│   │   ├── store/           # Zustand stores
│   │   │   └── authStore.js
│   │   ├── utils/           # Utility functions
│   │   │   └── api.js
│   │   ├── App.jsx          # Root component
│   │   ├── main.jsx         # Entry point
│   │   └── index.css        # Global styles
│   ├── Dockerfile           # Multi-stage Docker build
│   ├── nginx.conf           # Nginx configuration
│   ├── vite.config.js       # Vite configuration
│   └── package.json
├── demo/
│   └── index.html           # Original demo
├── docker-compose.yml       # Docker Compose config
└── README.md
```

## Development

### Prerequisites
- Node.js 18 or higher
- npm or yarn

### Setup

1. Install dependencies:
```bash
cd frontend
npm install
```

2. Start development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### Available Scripts

- `npm run dev` - Start development server with HMR
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally

## Production Deployment

### Using Docker Compose

Build and run the entire stack:

```bash
docker compose up --build
```

The application will be available at `http://localhost`

### Manual Docker Build

Build the frontend image:

```bash
cd frontend
docker build -t integrationhub-frontend .
```

Run the container:

```bash
docker run -p 80:80 integrationhub-frontend
```

## Features

### Authentication
- Login page with email/password
- Protected routes
- Persistent authentication state
- Auto-redirect to login on 401

### Dashboard
- Real-time statistics
- Recent backup history
- Application status overview
- Responsive layout

### Backup Wizard
- Multi-step workflow
- Application selection
- Configuration options
- Confirmation step
- Support for multiple cloud providers

### UI/UX
- Responsive design (mobile, tablet, desktop)
- Dark/light theme support
- Collapsible sidebar
- Professional Ant Design components
- Smooth transitions and animations

## Environment Variables

Create a `.env` file in the frontend directory:

```env
VITE_API_URL=http://localhost:8000
```

## Docker Architecture

### Multi-stage Build

1. **Builder Stage** (node:18-alpine)
   - Install dependencies
   - Build production assets
   - Optimize bundle size

2. **Production Stage** (nginx:alpine)
   - Copy built assets
   - Configure Nginx
   - Minimal image size (~25MB)

### Nginx Configuration

- SPA routing support
- Gzip compression
- Static asset caching
- Security headers
- Cache busting for index.html

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## License

MIT
# IntegrationHub - Quick Start Guide

## 🚀 Running the Application

### 1. Start Frontend (React + Vite)
```bash
cd frontend
npm install         # First time only
npm run dev         # Start dev server
```
✅ **Frontend URL:** http://localhost:8080

### 2. Start Backend (Flask)
```bash
cd backend
pip install -r requirements.txt    # First time only
python app.py
```
✅ **Backend API:** http://localhost:5000

### 3. Start Database (PostgreSQL via Docker)
```bash
docker-compose up -d
```
✅ **Database:** PostgreSQL on port 5432

## 📂 Project Structure

```
integration app/
├── frontend/                     # React Application
│   ├── src/
│   │   ├── components/layout/    # MainLayout with sidebar
│   │   ├── pages/                # Dashboard, Backups, BackupWizard, Login
│   │   ├── services/            # API client (axios)
│   │   ├── store/               # State management (zustand)
│   │   ├── App.jsx              # Routes
│   │   ├── main.jsx             # Entry point
│   │   └── index.css            # Global styles
│   ├── index.html               # HTML shell
│   ├── vite.config.js           # Vite config (port 8080, proxy to backend)
│   ├── package.json             # Dependencies
│   └── README.md
│
├── backend/                      # Flask API
│   ├── api/
│   │   ├── auth/                # Google OAuth endpoints
│   │   └── backup/              # Backup CRUD + job management
│   ├── core/                     # Config, database setup
│   ├── models/                   # SQLAlchemy models
│   ├── workers/                  # Background backup workers
│   ├── app.py                    # Main Flask app
│   └── requirements.txt
│
├── docker-compose.yml            # PostgreSQL database
├── API_DOCUMENTATION.md          # All API endpoints documented
├── DATABASE_STRUCTURE.md         # Database schema
└── REACT_MIGRATION_COMPLETE.md   # Migration summary
```

## 🔌 Tech Stack

### Frontend
- React 18.3.1
- Vite 5.4.2
- Ant Design 5.20.0
- React Router DOM 6.26.0
- Axios 1.7.2
- Zustand 4.5.5
- Day.js 1.11.11

### Backend
- Flask 3.0
- SQLAlchemy
- PostgreSQL
- Google OAuth (google-auth, google-auth-oauthlib, google-api-python-client)

## 📖 Key Features

### ✅ Implemented
- Google OAuth authentication (Sheets + Drive)
- Backup configuration CRUD
- Backup job management
- Multi-step backup wizard
- Dashboard with statistics
- Responsive UI with Ant Design

### ⏳ TODO
- Complete worker execution logic
- Real-time job status updates
- Error handling & retry logic
- Base API integration
- Advanced scheduling options

## 🌐 API Endpoints

### Authentication (`/api/auth`)
- `GET /google/sheets/url` - Get Sheets OAuth URL
- `GET /google/drive/url` - Get Drive OAuth URL
- `POST /google/callback` - Handle OAuth callback
- `POST /google/verify` - Verify token
- `POST /google/revoke` - Revoke token

### Backup Configs (`/api/backup`)
- `GET /configs` - List all configurations
- `GET /configs/:id` - Get configuration details
- `POST /configs` - Create new configuration
- `PUT /configs/:id` - Update configuration
- `DELETE /configs/:id` - Delete configuration

### Backup Jobs (`/api/backup`)
- `GET /jobs` - List all jobs (optional: ?config_id=X)
- `GET /jobs/:id` - Get job details
- `POST /start` - Start backup job
- `PUT /jobs/:id/status` - Update job status
- `GET /stats` - Get backup statistics

See [API_DOCUMENTATION.md](API_DOCUMENTATION.md) for full details.

## 🎨 Frontend Pages

1. **Login** (`/`) - Mock authentication
2. **Dashboard** (`/dashboard`) - Stats + recent jobs
3. **Backups** (`/backups`) - List configurations
4. **Backup Wizard** (`/backups/new`) - Create/edit configuration
   - Step 1: Basic Info
   - Step 2: Source (Google Sheets, MySQL, PostgreSQL)
   - Step 3: Destination (Google Drive, Local, S3)
   - Step 4: Schedule (Manual, Hourly, Daily, Weekly)

## 🔧 Development

### Frontend
```bash
cd frontend
npm run dev        # Start dev server (port 8080)
npm run build      # Build for production
npm run preview    # Preview production build
```

### Backend
```bash
cd backend
python app.py      # Start Flask server (port 5000)
```

### Database
```bash
docker-compose up -d       # Start PostgreSQL
docker-compose down        # Stop PostgreSQL
docker-compose logs -f     # View logs
```

## 🐳 Docker

### Build Images
```bash
docker-compose build
```

### Run All Services
```bash
docker-compose up -d
```

### View Logs
```bash
docker-compose logs -f
```

## 🔐 Environment Variables

Create `.env` file in backend:
```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
DATABASE_URL=postgresql://user:password@localhost:5432/integrationhub
SECRET_KEY=your_secret_key
```

## 📝 Notes

- Frontend dev server runs on **port 8080**
- Backend API runs on **port 5000**
- Vite proxies `/api` requests to Flask backend
- Login is currently mock authentication (any credentials work)
- Auth state persisted in localStorage using Zustand

## 🆘 Troubleshooting

**Port already in use:**
```bash
# Windows
netstat -ano | findstr :8080
taskkill /PID <PID> /F

# Kill and restart
npm run dev
```

**API calls failing:**
- Ensure backend is running on port 5000
- Check browser console & network tab
- Verify proxy config in `vite.config.js`

**Database connection error:**
- Check docker-compose is running: `docker-compose ps`
- Test connection: `psql -h localhost -p 5432 -U postgres`

## 📚 Documentation

- [API_DOCUMENTATION.md](API_DOCUMENTATION.md) - Complete API reference
- [DATABASE_STRUCTURE.md](DATABASE_STRUCTURE.md) - Database schema
- [backend/SETUP_GUIDE.md](backend/SETUP_GUIDE.md) - Backend setup
- [frontend/README.md](frontend/README.md) - Frontend details
- [REACT_MIGRATION_COMPLETE.md](REACT_MIGRATION_COMPLETE.md) - Migration summary

---

**Ready to use!** Open http://localhost:8080 in your browser 🚀
