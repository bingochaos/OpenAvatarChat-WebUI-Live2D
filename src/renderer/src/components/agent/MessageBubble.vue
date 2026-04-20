<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '@/interface/agent'
import ToolCallCard from './ToolCallCard.vue'

const props = defineProps<{ message: ChatMessage }>()

const roleClass = computed(() => `bubble bubble-${props.message.role}`)
const roleLabel = computed(() => {
  if (props.message.role === 'user') return '你'
  if (props.message.role === 'assistant') return 'Claude'
  return '系统'
})
</script>

<template>
  <div :class="roleClass">
    <div class="meta">{{ roleLabel }}</div>
    <div v-if="message.text" class="text">{{ message.text }}</div>
    <div v-if="message.toolCalls.length" class="tool-calls">
      <ToolCallCard v-for="call in message.toolCalls" :key="call.callId" :call="call" />
    </div>
    <div v-if="message.error" class="error">⚠ {{ message.error }}</div>
  </div>
</template>

<style scoped lang="less">
.bubble {
  padding: 8px 12px;
  border-radius: 10px;
  margin-bottom: 10px;
  line-height: 1.55;
  font-size: 13px;
  word-break: break-word;
  white-space: pre-wrap;
}
.bubble-user {
  align-self: flex-end;
  background: #1677ff;
  color: #fff;
  max-width: 85%;
}
.bubble-assistant {
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.88);
  color: #222;
  max-width: 95%;
}
.bubble-system {
  align-self: center;
  background: rgba(255, 255, 255, 0.7);
  color: #666;
  font-size: 12px;
  max-width: 90%;
}
.meta {
  font-size: 11px;
  opacity: 0.7;
  margin-bottom: 3px;
}
.tool-calls {
  margin-top: 4px;
}
.error {
  margin-top: 6px;
  color: #cf1322;
  font-size: 12px;
}
</style>
