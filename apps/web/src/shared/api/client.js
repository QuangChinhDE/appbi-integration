import axios from 'axios'

/**
 * Single axios client for the SPA. Auth is cookie-based:
 * - `withCredentials: true` makes the browser attach the httpOnly
 *   `access_token` cookie to every same-origin request (or cross-origin
 *   request when CORS allow_credentials is enabled).
 * - No Authorization header is set from JS — the cookie is the source of
 *   truth. This mirrors the appbi-ai pattern.
 *
 * 401 handling: clear the client-side session cache and bounce to /login,
 * unless we're already there (avoids a feedback loop when the login POST
 * itself returns 401 for bad credentials).
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 10000,
  withCredentials: true,
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    if (status === 401 && typeof window !== 'undefined') {
      const onLoginPage = window.location?.pathname === '/login'
      if (!onLoginPage) {
        window.location.replace('/login')
      }
    }
    return Promise.reject(error)
  },
)

export default api
