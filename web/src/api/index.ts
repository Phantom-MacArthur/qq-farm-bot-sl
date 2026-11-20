import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { useStorage } from '@vueuse/core'
import axios from 'axios'
import { readonly, ref, watch } from 'vue'
import { useToastStore } from '@/stores/toast'

export const selectedAccountId = useStorage('current_account_id', '')
const offlineResponse = ref(false)
export const hasAccountOfflineResponse = readonly(offlineResponse)

let accountEpoch = 0
let offlineRevision = 0
let confirmedConnected: boolean | undefined
const accountRequests = new WeakMap<InternalAxiosRequestConfig, { epoch: number, offlineRevision: number }>()

watch(selectedAccountId, () => {
  accountEpoch++
  confirmedConnected = undefined
  offlineResponse.value = false
}, { flush: 'sync' })

export function isAccountOfflineCode(code: unknown): boolean {
  return code === 'ACCOUNT_OFFLINE' || code === 'GAME_OFFLINE'
}

export function reportAccountOfflineResponse(response: AxiosResponse, code: unknown) {
  if (!isAccountOfflineCode(code))
    return false

  const { config } = response
  if (selectedAccountId.value && !config.signal?.aborted && accountRequests.get(config)?.epoch === accountEpoch) {
    if (!offlineResponse.value)
      offlineRevision++
    offlineResponse.value = true
  }
  return true
}

export function confirmAccountConnection(accountId: string, connected: boolean, response?: AxiosResponse) {
  if (!accountId || accountId !== selectedAccountId.value)
    return
  if (response) {
    const request = accountRequests.get(response.config)
    if (request?.epoch !== accountEpoch || (connected && request.offlineRevision !== offlineRevision))
      return
  }

  // Do not let requests issued before a reconnection mark the account offline again.
  if (connected && (confirmedConnected === false || offlineResponse.value)) {
    accountEpoch++
    offlineResponse.value = false
  }
  confirmedConnected = connected
}

const api = axios.create({
  baseURL: '/',
  timeout: 10000,
})

export function normalizeApiErrorMessage(raw: unknown): string {
  const text = String(raw || '').trim()
  if (!text)
    return ''

  const codeMatch = text.match(/\bcode=\d+\b(.*)$/)
  const codeIndex = codeMatch?.index ?? -1
  if (codeMatch?.[1] && codeIndex >= 0 && text.slice(0, codeIndex).includes('.'))
    return codeMatch[1].trim()
  return text
}

export function getApiErrorMessage(error: unknown, fallback = '请求失败'): string {
  const candidate = error as any
  const data = candidate?.response?.data
    || (candidate && typeof candidate === 'object' ? candidate : null)
  const raw = data?.errorMessage
    || data?.error
    || data?.message
    || candidate?.message
    || (typeof error === 'string' ? error : '')
  return normalizeApiErrorMessage(raw) || fallback
}

api.interceptors.request.use((config) => {
  const accountId = selectedAccountId.value
  if (accountId && !config.headers.has('x-account-id')) {
    config.headers.set('x-account-id', accountId)
  }
  if (accountId && config.headers.get('x-account-id') === accountId)
    accountRequests.set(config, { epoch: accountEpoch, offlineRevision })
  return config
}, undefined, { synchronous: true })

api.interceptors.response.use((response) => {
  const responseData = response?.data
  const skipToast = (response?.config as any)?.skipErrorToast
  if (responseData && typeof responseData === 'object' && responseData.ok === false) {
    if (reportAccountOfflineResponse(response, responseData.errorCode))
      return response
    const message = getApiErrorMessage(responseData, '')
    if (message) {
      responseData.error = message
      if (!skipToast)
        useToastStore().error(message)
    }
  }
  return response
}, (error) => {
  // Aborting an in-flight request is expected when a modal closes or a QR flow restarts.
  if (axios.isCancel(error) || error?.code === 'ERR_CANCELED')
    return Promise.reject(error)
  if (error?.response && reportAccountOfflineResponse(error.response, error.response.data?.errorCode))
    return Promise.reject(error)

  const toast = useToastStore()
  const normalizedMessage = getApiErrorMessage(error, '')
  if (normalizedMessage) {
    error.message = normalizedMessage
    if (error.response?.data && typeof error.response.data === 'object')
      error.response.data.error = normalizedMessage
  }

  // 支持 skipErrorToast 配置，让调用方自行处理错误
  const skipToast = error.config?.skipErrorToast

  if (error.response) {
    if (error.response.status >= 500) {
      const backendError = getApiErrorMessage(error, '')
      // 后端运行态可预期错误：不弹全局500，交给页面状态处理
      if (backendError === 'API Timeout') {
        return Promise.reject(error)
      }
      if (!skipToast) {
        toast.error(backendError || '请求失败，请稍后重试')
      }
    }
    else {
      if (!skipToast) {
        toast.error(getApiErrorMessage(error, `请求失败，请联系管理员！`))
      }
    }
  }
  else if (error.request) {
    if (!skipToast) {
      toast.error('网络错误，无法连接到服务器')
    }
  }
  else {
    if (!skipToast) {
      toast.error(`错误: ${getApiErrorMessage(error, '请求失败')}`)
    }
  }

  return Promise.reject(error)
})

export default api
