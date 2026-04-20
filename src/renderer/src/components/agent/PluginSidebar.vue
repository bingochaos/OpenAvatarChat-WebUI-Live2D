<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { List, ListItem, Tooltip } from 'ant-design-vue'
import { useAgentStore } from '@/store/agent'

const agent = useAgentStore()
const { plugins, apiReady } = storeToRefs(agent)

function dotColor(state: string) {
  switch (state) {
    case 'ready':
      return '#52c41a'
    case 'error':
      return '#ff4d4f'
    case 'disposed':
      return '#bfbfbf'
    default:
      return '#faad14'
  }
}

const apiBadge = computed(() => (apiReady.value ? '#52c41a' : '#ff4d4f'))
const apiText = computed(() =>
  apiReady.value ? 'ANTHROPIC_API_KEY 已配置' : '未检测到 API Key，请补充 .env'
)
</script>

<template>
  <aside class="plugin-sidebar">
    <div class="header">Agent 状态</div>

    <div class="api-row">
      <span class="dot" :style="{ background: apiBadge }" />
      <span class="api-text">{{ apiText }}</span>
    </div>

    <div class="section-title">插件</div>
    <List :split="false" size="small">
      <ListItem v-for="p in plugins" :key="p.id" class="plugin-row">
        <span class="dot" :style="{ background: dotColor(p.state) }" />
        <div class="meta">
          <div class="name">{{ p.name }}</div>
          <Tooltip v-if="p.error" :title="p.error">
            <div class="err">{{ p.error }}</div>
          </Tooltip>
          <div class="tools">tools: {{ p.tools.length }}</div>
        </div>
      </ListItem>
      <ListItem v-if="plugins.length === 0" class="empty">暂无已注册插件</ListItem>
    </List>
  </aside>
</template>

<style scoped lang="less">
.plugin-sidebar {
  width: 220px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.92);
  border-left: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #222;
}
.header {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
}
.section-title {
  margin-top: 10px;
  font-size: 12px;
  color: #666;
}
.api-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.api-text {
  flex: 1;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.plugin-row {
  display: flex !important;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0 !important;
}
.meta {
  flex: 1;
  min-width: 0;
}
.name {
  font-size: 13px;
  font-weight: 500;
}
.tools {
  font-size: 11px;
  color: #888;
}
.err {
  font-size: 11px;
  color: #cf1322;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.empty {
  color: #999;
  font-size: 12px;
}
</style>
