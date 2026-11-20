import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export const useIllustratedStore = defineStore('illustrated', () => {
  const data = ref<any>(null)
  const loading = ref(false)
  const error = ref(false)
  let requestId = 0

  async function fetch(accountId: string) {
    if (!accountId)
      return false
    const id = ++requestId
    loading.value = true
    error.value = false
    try {
      const response = await api.get('/api/illustrated', {
        headers: { 'x-account-id': accountId },
        skipErrorToast: true,
      } as any)
      if (id !== requestId)
        return false
      if (!response.data?.ok) {
        error.value = true
        return false
      }
      data.value = response.data.data || null
      return true
    }
    catch {
      if (id !== requestId)
        return false
      error.value = true
      return false
    }
    finally {
      if (id === requestId)
        loading.value = false
    }
  }

  function reset() {
    requestId++
    data.value = null
    loading.value = false
    error.value = false
  }

  return { data, loading, error, fetch, reset }
})
