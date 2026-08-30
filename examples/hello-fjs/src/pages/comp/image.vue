<route>
{"title": "图片", "tag": "image", "group": "基础内容"}
</route>

<script setup lang="ts">
// image：src 支持 http(s) 与 asset 路径，映射 Image.network / AssetImage。
import Panel from '../../components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <image> 才不会被当成自引用。
defineOptions({ name: 'ImagePage' });

const remote = 'https://picsum.photos/seed/fjs/600/400';
</script>

<template>
  <view>
    <Panel title="网络图片" desc="需要设备联网；无网时显示占位区域">
      <image :src="remote" class="banner" />
    </Panel>

    <Panel title="尺寸与圆角">
      <view class="row">
        <image :src="remote" class="thumb round" />
        <image :src="remote" class="thumb rounded" />
        <image :src="remote" class="thumb" />
      </view>
      <text class="caption">圆形头像 / 圆角 / 直角</text>
    </Panel>

    <Panel title="图文卡片">
      <view class="card-row">
        <image :src="remote" class="cover" />
        <view class="card-body">
          <text class="card-title">列表图文</text>
          <text class="card-desc">
            image 与 view / text 组合，就是最常见的信息流卡片布局。
          </text>
        </view>
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.banner {
  height: 160px;
  border-radius: 10px;
}
.row {
  flex-direction: row;
  gap: 12px;
  align-items: center;
}
.thumb {
  width: 64px;
  height: 64px;
}
.round {
  border-radius: 32px;
}
.rounded {
  border-radius: 10px;
}
.caption {
  font-size: 12px;
  color: #999999;
}
.card-row {
  flex-direction: row;
  gap: 12px;
}
.cover {
  width: 96px;
  height: 72px;
  border-radius: 8px;
}
.card-body {
  flex-grow: 1;
  gap: 4px;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
}
.card-desc {
  font-size: 12px;
  color: #999999;
  max-lines: 2;
  overflow: ellipsis;
}
</style>
