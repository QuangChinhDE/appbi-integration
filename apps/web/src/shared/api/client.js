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

export const usersApi = {
  async getShareable() {
    const response = await api.get('/api/users/shareable')
    return response.data
  },
}

export const sharesApi = {
  async getShares(resourceType, resourceId) {
    const response = await api.get(`/api/shares/${resourceType}/${resourceId}`)
    return response.data
  },
  async share(resourceType, resourceId, payload) {
    const response = await api.post(`/api/shares/${resourceType}/${resourceId}`, payload)
    return response.data
  },
  async updateShare(resourceType, resourceId, userId, payload) {
    const response = await api.put(`/api/shares/${resourceType}/${resourceId}/${userId}`, payload)
    return response.data
  },
  async revokeShare(resourceType, resourceId, userId) {
    const response = await api.delete(`/api/shares/${resourceType}/${resourceId}/${userId}`)
    return response.data
  },
  async shareAllTeam(resourceType, resourceId, payload) {
    const response = await api.post(`/api/shares/${resourceType}/${resourceId}/all-team`, payload)
    return response.data
  },
}

export default api
