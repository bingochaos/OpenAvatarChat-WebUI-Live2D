<script setup lang="ts">
import { computed } from 'vue'
import { Collapse, CollapsePanel, Tag } from 'ant-design-vue'
import type { ToolCallView } from '@/interface/agent'

const props = defineProps<{ call: ToolCallView }>()

const statusColor = computed(() => {
  if (props.call.status === 'running') return 'processing'
  if (props.call.status === 'error') return 'error'
  return 'success'
})

const statusText = computed(() => {
  if (props.call.status === 'running') return '执行中'
  if (props.call.status === 'error') return '失败'
  return '成功'
})

const resultPreview = computed(() => {
  const result = props.call.result
  if (!result) return '(等待结果)'
  if (!result.success) return result.error ?? '未知错误'
  try {
    return JSON.stringify(result.data, null, 2)
  } catch {
    return String(result.data)
  }
})

const inputPreview = computed(() => {
  try {
    return JSON.stringify(props.call.input, null, 2)
  } catch {
    return String(props.call.input)
  }
})
</script>

<template>
  <Collapse class="tool-call-card" size="small">
    <CollapsePanel :key="call.callId">
      <template #header>
        <div class="tool-call-header">
          <Tag :color="statusColor">{{ statusText }}</Tag>
          <span class="tool-name">{{ call.name }}</span>
          <span v-if="call.durationMs !== undefined" class="duration">{{ call.durationMs }}ms</span>
        </div>
      </template>

      <div class="block">
        <div class="label">Input</div>
        <pre>{{ inputPreview }}</pre>
      </div>
      <div class="block">
        <div class="label">Result</div>
        <pre>{{ resultPreview }}</pre>
      </div>
    </CollapsePanel>
  </Collapse>
</template>

<style scoped lang="less">
.tool-call-card {
  margin-top: 6px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 6px;
}
.tool-call-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.tool-name {
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace;
}
.duration {
  margin-left: auto;
  color: #999;
  font-size: 11px;
}
.block {
  margin-bottom: 8px;
  .label {
    font-size: 11px;
    color: #888;
    margin-bottom: 2px;
  }
  pre {
    margin: 0;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 4px;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 240px;
    overflow: auto;
  }
}
</style>
