<script setup lang="ts">
import { CloseOutlined } from '@ant-design/icons-vue'
import ChatPanel from '@/components/agent/ChatPanel.vue'
import PluginSidebar from '@/components/agent/PluginSidebar.vue'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <div v-if="visible" class="agent-overlay">
    <div class="agent-frame">
      <header class="bar">
        <span class="title">Claude Agent</span>
        <button class="close" @click="emit('close')">
          <CloseOutlined />
        </button>
      </header>
      <div class="body">
        <ChatPanel />
        <PluginSidebar />
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.agent-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}
.agent-frame {
  width: min(92vw, 880px);
  height: min(86vh, 640px);
  background: rgba(255, 255, 255, 0.96);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.25);
}
.bar {
  height: 36px;
  background: #1677ff;
  color: #fff;
  display: flex;
  align-items: center;
  padding: 0 12px;
}
.title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
}
.close {
  border: 0;
  background: transparent;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 6px;
  border-radius: 4px;
}
.close:hover {
  background: rgba(255, 255, 255, 0.2);
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
</style>
