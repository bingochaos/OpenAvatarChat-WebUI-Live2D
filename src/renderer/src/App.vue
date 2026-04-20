<script setup lang="ts">
import { ref } from 'vue'
import { ConfigProvider } from 'ant-design-vue'
import { RobotOutlined } from '@ant-design/icons-vue'
import { storeToRefs } from 'pinia'

import WebcamPermission from '@/components/WebcamPermission.vue'
import { antdLocale, locale } from '@/langs'
import VideoChat from '@/views/VideoChat/index.vue'
import WSVideoChat from './views/WSVideoChat/index.vue'
import AgentChat from '@/views/AgentChat/index.vue'
import { useAppStore } from './store/app'
import { useMediaStore } from './store/media'
import isElectron from './utils/isElectron'

const appState = useAppStore()
const mediaState = useMediaStore()
const { chatMode } = storeToRefs(appState)
appState.init()

const agentVisible = ref(false)
function toggleAgent() {
  agentVisible.value = !agentVisible.value
}
</script>
<template>
  <ConfigProvider :locale="antdLocale[locale]">
    <div
      v-if="isElectron"
      class="wrap"
      :style="{
        backgroundImage: 'none',
      }"
    >
      <WebcamPermission v-if="!mediaState.webcamAccessed" auto-access />
      <template v-if="chatMode === 'ws'">
        <WSVideoChat />
      </template>
      <template v-else>
        <VideoChat />
      </template>
      <button
        class="agent-fab"
        :class="{ active: agentVisible }"
        title="Claude Agent"
        @click="toggleAgent"
      >
        <RobotOutlined />
      </button>
      <AgentChat :visible="agentVisible" @close="agentVisible = false" />
    </div>
    <div v-else class="wrap">
      <WebcamPermission v-if="!mediaState.webcamAccessed" />
      <template v-if="chatMode === 'ws'">
        <WSVideoChat />
      </template>
      <template v-else>
        <VideoChat />
      </template>
    </div>
  </ConfigProvider>
</template>
<style lang="less" scoped>
.wrap {
  background-image: url(@/assets/background.png);
  height: calc(max(80vh, 100%));
  background-size: 100% 100%;
  background-repeat: no-repeat;
  position: relative;
  *::-webkit-scrollbar {
    display: none;
  }
}
.agent-fab {
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 0;
  background: #1677ff;
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(22, 119, 255, 0.35);
  z-index: 9998;
  transition: transform 0.15s;
}
.agent-fab:hover {
  transform: translateY(-1px);
}
.agent-fab.active {
  background: #0958d9;
}
</style>
