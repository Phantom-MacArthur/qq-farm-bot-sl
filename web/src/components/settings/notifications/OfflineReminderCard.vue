<script setup lang="ts">
import type { OfflineConfig } from '@/stores/setting'
import { computed } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'

defineProps<{ disabled?: boolean }>()

const config = defineModel<OfflineConfig>('config', { required: true })

const channelOptions = [
  { label: 'WxPusher(SPT)', value: 'wxpusher', docs: 'https://wxpusher.zjiecode.com/docs/#/' },
  { label: 'WxPusher(标准)', value: 'wxpusher_wechat', docs: 'https://wxpusher.zjiecode.com/docs/api-reference.html' },
  { label: 'Qmsg 酱', value: 'qmsg', docs: 'https://qmsg.zendee.cn/' },
  { label: 'Bark（iPhone 推送）', value: 'bark', docs: 'https://github.com/Finb/Bark' },
]
const currentChannelDocUrl = computed(() => channelOptions.find(option => option.value === config.value.channel)?.docs)

function openChannelDocs() {
  if (currentChannelDocUrl.value)
    window.open(currentChannelDocUrl.value, '_blank', 'noopener,noreferrer')
}

// 分渠道凭据：token / wxPusherUid 均按当前渠道分别保存。
const activeToken = computed({
  get: () => config.value.channelCredentials[config.value.channel]?.token || '',
  set: (token: string) => {
    const current = config.value.channelCredentials[config.value.channel] || { token: '', wxPusherUid: '' }
    config.value.channelCredentials[config.value.channel] = { ...current, token }
  },
})
const activeWxPusherUid = computed({
  get: () => config.value.channelCredentials[config.value.channel]?.wxPusherUid || '',
  set: (wxPusherUid: string) => {
    const current = config.value.channelCredentials[config.value.channel] || { token: '', wxPusherUid: '' }
    config.value.channelCredentials[config.value.channel] = { ...current, wxPusherUid }
  },
})
</script>

<template>
  <!-- 外层 SettingsPanel 已经是一张白卡，这里再套一层 page-card-surface 会在面板里多出一圈
       1px 描边和投影，外围与圆角处看起来就是灰边；本组件只负责排内容。 -->
  <div>
    <div class="space-y-3">
      <!-- 推送渠道与凭据同一行且全部等宽：渠道下拉不再固定 180px 短于输入框。 -->
      <div class="flex flex-wrap items-end gap-3">
        <div class="min-w-[180px] flex flex-1 flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <span class="text-sm text-gray-700 font-medium dark:text-gray-300">推送渠道</span>
            <!-- 官网常驻下划线，悬停变蓝；BaseButton 上的颜色类需要 ! 前缀才压得住 naive-ui -->
            <BaseButton
              variant="text"
              size="sm"
              class="underline decoration-1 underline-offset-2 hover:!text-blue-600 dark:hover:!text-blue-400"
              :disabled="!currentChannelDocUrl"
              @click="openChannelDocs"
            >
              官网
            </BaseButton>
          </div>
          <BaseSelect
            v-model="config.channel"
            :options="channelOptions"
            :disabled="disabled"
          />
        </div>

        <template v-if="config.channel === 'wxpusher_wechat'">
          <div class="min-w-[180px] flex-1">
            <BaseInput
              v-model="activeToken"
              label="WxPusher AppToken"
              type="password"
              :disabled="disabled"
              placeholder="以 AT_ 开头的应用令牌"
            />
          </div>
          <div class="min-w-[180px] flex-1">
            <BaseInput
              v-model="activeWxPusherUid"
              label="WxPusher 接收者 UID"
              type="text"
              :disabled="disabled"
              placeholder="以 UID_ 开头的用户标识"
            />
          </div>
        </template>
        <div v-else class="min-w-[180px] flex-1">
          <BaseInput
            v-if="config.channel === 'wxpusher'"
            v-model="activeToken"
            label="WxPusher SPT"
            type="password"
            :disabled="disabled"
            placeholder="以 SPT_ 开头的极简推送令牌"
          />
          <BaseInput
            v-else-if="config.channel === 'bark'"
            v-model="activeToken"
            label="Bark Key 或服务器 URL"
            type="password"
            :disabled="disabled"
            placeholder="设备 Key 或 https://api.day.app/设备Key/"
          />
          <BaseInput
            v-else
            v-model="activeToken"
            label="Qmsg 酱 Key"
            type="password"
            :disabled="disabled"
            placeholder="在 Qmsg 酱管理台获取"
          />
        </div>
      </div>

    </div>
  </div>
</template>
