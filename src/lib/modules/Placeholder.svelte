<script lang="ts">
  let { title }: { title: string } = $props();
</script>

<div class="text-sm opacity-70">
  <p>Placeholder module: <span class="font-mono">{title}</span></p>
  <p class="mt-2">Harness content will render here.</p>
</div>
