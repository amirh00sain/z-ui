import axios, { AxiosError } from 'axios'
import type { ApiResponse } from '@/types'
import { pushToast } from '@/lib/notify'

const request = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

// Request interceptor: attach the JWT token automatically
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: redirect to login on 401
request.interceptors.response.use(
  (response) => {
    const payload = response.data as ApiResponse<unknown> | undefined
    if (payload && typeof payload === 'object' && 'code' in payload && payload.code !== 0) {
      const message = payload.message || 'Request failed'
      pushToast({
        title: 'API request failed',
        description: message,
        variant: 'error',
      })
      return Promise.reject(new Error(message))
    }
    return response
  },
  (error) => {
    if (error.response?.status === 401) {
      // Clear alongside store/auth.logout (token / username / role)
      localStorage.removeItem('token')
      localStorage.removeItem('admin_username')
      localStorage.removeItem('admin_role')
      window.location.href = '/login'
      return Promise.reject(error)
    }

    const axiosError = error as AxiosError<ApiResponse<unknown>>
    const message =
      axiosError.response?.data?.message ||
      axiosError.message ||
      'Network error, please try again later'

    pushToast({
      title: axiosError.response ? 'API request failed' : 'Network connection error',
      description: message,
      variant: 'error',
    })

    return Promise.reject(new Error(message))
  }
)

export default request
