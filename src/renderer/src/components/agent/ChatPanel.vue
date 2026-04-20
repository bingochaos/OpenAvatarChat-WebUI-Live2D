<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Button, Input, Space } from 'ant-design-vue'
import { ClearOutlined, SendOutlined, StopOutlined } from '@ant-design/icons-vue'
import { useAgentStore } from '@/store/agent'
import MessageBubble from './MessageBubble.vue'
import ToolCallCard from './ToolCallCard.vue'

const agent = useAgentStore()
const { messages, running, currentAssistantText, currentToolCalls, lastError } = storeToRefs(agent)

const text = ref('')
const listEl = ref<HTMLElement | null>(null)

const streamingToolCalls = computed(() => Object.values(currentToolCalls.value))
const hasStreaming = computed(
  () => Boolean(currentAssistantText.value) || streamingToolCalls.value.length > 0
)

onMounted(() => {
  agent.init()
})

async function scrollToBottom() {
  await nextTick()
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  [messages, currentAssistantText, currentToolCalls],
  () => {
    scrollToBottom()
  },
  { deep: true }
)

async function onSend() {
  const value = text.value
  if (!value.trim() || running.value) return
  text.value = ''
  await agent.send(value)
}

function onAbort() {
  agent.abort()
}

function onClear() {
  agent.clear()
}
</script>

<template>
  <section class="chat-panel">
    <div ref="listEl" class="message-list">
      <MessageBubble v-for="m in messages" :key="m.id" :message="m" />

      <div v-if="hasStreaming" class="bubble bubble-assistant streaming">
        <div class="meta">Claude (streaming…)</div>
        <div v-if="currentAssistantText" class="text">{{ currentAssistantText }}</div>
        <div v-if="streamingToolCalls.length" class="tool-calls">
          <ToolCallCard v-for="call in streamingToolCalls" :key="call.callId" :call="call" />
        </div>
      </div>

      <div v-if="lastError" class="error-banner">⚠ {{ lastError }}</div>
    </div>

    <div class="input-row">
      <Input.TextArea
        v-model:value="text"
        :auto-size="{ minRows: 1, maxRows: 4 }"
        placeholder="和 Claude 说点什么…  (Ctrl+Enter 发送)"
        :disabled="running"
        @keydown.ctrl.enter.prevent="onSend"
        @keydown.meta.enter.prevent="onSend"
      />

      <Space :size="6">
        <Button v-if="!running" type="primary" :disabled="!text.trim()" @click="onSend">
          <template #icon><SendOutlined /></template>
          发送
        </Button>
        <Button v-else danger @click="onAbort">
          <template #icon><StopOutlined /></template>
          停止
        </Button>
        <Button @click="onClear">
          <template #icon><ClearOutlined /></template>
          清空
        </Button>
      </Space>
    </div>
  </section>
</template>

<style scoped lang="less">
.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: rgba(248, 250, 252, 0.88);
}
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
}
.bubble {
  padding: 8px 12px;
  border-radius: 10px;
  margin-bottom: 10px;
  line-height: 1.55;
  font-size: 13px;
  word-break: break-word;
  white-space: pre-wrap;
}
.bubble-assistant {
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.88);
  color: #222;
  max-width: 95%;
}
.streaming {
  border: 1px dashed rgba(22, 119, 255, 0.4);
}
.meta {
  font-size: 11px;
  opacity: 0.7;
  margin-bottom: 3px;
}
.error-banner {
  align-self: center;
  margin-top: 8px;
  padding: 6px 10px;
  background: rgba(255, 77, 79, 0.12);
  color: #cf1322;
  border-radius: 6px;
  font-size: 12px;
  max-width: 95%;
}
.input-row {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding: 10px 12px;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  background: rgba(255, 255, 255, 0.9);
}
.input-row :deep(textarea) {
  resize: none;
}
</style>
