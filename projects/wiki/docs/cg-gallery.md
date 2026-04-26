<script setup>
import { ref } from "vue"
const show = ref(false)
const src = ref("")
const alt = ref("")
function openCg(e) {
  const img = e.target.closest("img")
  if (img && img.closest(".cg-grid")) {
    src.value = img.src
    alt.value = img.alt
    show.value = true
  }
}
function closeCg() { show.value = false }
</script>

<style>
.cg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:2px;margin:8px 0}
@media(min-width:768px){.cg-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:3px}}
.cg-grid img{width:100%;aspect-ratio:16/9;object-fit:cover;cursor:pointer;border-radius:2px;transition:opacity .15s}
.cg-grid img:hover{opacity:.8}
.cg-overlay{position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer}
.cg-overlay img{max-width:95vw;max-height:90vh;object-fit:contain;border-radius:4px}
.cg-overlay span{color:#888;font-size:13px;margin-top:8px}
</style>

<div v-if="show" class="cg-overlay" @click="closeCg">
  <img :src="src" :alt="alt" />
  <span>{{ alt }}</span>
</div>

# CG 画廊

> 共 404 张 CG，15 个章节 | 点击缩略图查看大图

## 主线章节

### Arc 1 - Prologue (序章)（13）

<details><summary>13 张未包含图片文件</summary>

- `CGDynamic_C00_001Bj`
- `CGDynamic_C00_001Boy`
- `CGDynamic_C00_001Girl`
- `CG_C00_001`
- `CG_C00_004`
- `CG_C00_007`
- `CG_C00_008`
- `CG_C00_009`
- `CG_C00_010`
- `CG_C00_011`
- `CG_C00_012`
- `CG_C00_013`
- `CG_C00_014`

</details>

### Arc 1 - Ch.1 东区秘事（41）

<details><summary>41 张未包含图片文件</summary>

- `CGDynamic_C01_001_A`
- `CGDynamic_C01_001_B`
- `CGDynamic_C01_001_C`
- `CGDynamic_C01_002_A`
- `CGDynamic_C01_002_B`
- `CGDynamic_C01_002_C`
- `CGDynamic_C01_003_A`
- `CGDynamic_C01_003_B`
- `CGDynamic_C01_003_C`
- `CGDynamic_C01_003_D`
- `CGDynamic_C01_004_A`
- `CGDynamic_C01_004_B`
- `CGDynamic_C01_004_C`
- `CGDynamic_C01_005_A`
- `CGDynamic_C01_005_B`
- `CGDynamic_C01_005_C`
- `CGDynamic_C01_006Mask`
- `CGDynamic_C01_006MaskB`
- `CGDynamic_C01_006_A`
- `CGDynamic_C01_006_B`
- `CGDynamic_C01_006_C`
- `CGDynamic_C01_007_A`
- `CGDynamic_C01_007_B`
- `CGDynamic_C01_007_C`
- `CGDynamic_C01_008_A`
- `CGDynamic_C01_008_B`
- `CGDynamic_C01_008_C`
- `CGDynamic_C01_009_A`
- `CGDynamic_C01_009_B`
- `CGDynamic_C01_009_C`
- `CGDynamic_C01_010_A`
- `CGDynamic_C01_010_B`
- `CGDynamic_C01_010_C`
- `CGDynamic_C01_011_A`
- `CGDynamic_C01_011_B`
- `CGDynamic_C01_011_C`
- `CGDynamic_C01_012Dark`
- `CG_C01_001`
- `CG_C01_002`
- `CG_C01_003`
- `CG_C01_004`

</details>

### Arc 1 - Ch.2 以蜡像之名（6）

<details><summary>6 张未包含图片文件</summary>

- `CG_C02_001`
- `CG_C02_002`
- `CG_C02_003`
- `CG_C02_004`
- `CG_C02_005`
- `CG_C02_006`

</details>

### Arc 1 - Ch.3（7）

<details><summary>7 张未包含图片文件</summary>

- `CG_C03_001`
- `CG_C03_002`
- `CG_C03_003`
- `CG_C03_004`
- `CG_C03_005`
- `CG_C03_006`
- `CG_C03_007`

</details>

### Arc 1 - Ch.4（9）

<details><summary>9 张未包含图片文件</summary>

- `CG_C04_001`
- `CG_C04_002`
- `CG_C04_003`
- `CG_C04_004`
- `CG_C04_005`
- `CG_C04_006`
- `CG_C04_007`
- `CG_C04_008`
- `CG_C04_009`

</details>

### Arc 1 - Ch.5（5）

<details><summary>5 张未包含图片文件</summary>

- `CG_C05_002`
- `CG_C05_003`
- `CG_C05_004`
- `CG_C05_005`
- `CG_C05_006`

</details>

### Arc 1 - Ch.6（15）

<details><summary>15 张未包含图片文件</summary>

- `CG_C06_001`
- `CG_C06_002`
- `CG_C06_003`
- `CG_C06_004`
- `CG_C06_005`
- `CG_C06_006`
- `CG_C06_007`
- `CG_C06_008`
- `CG_C06_009`
- `CG_C06_010`
- `CG_C06_011`
- `CG_C06_012`
- `CG_C06_015`
- `CG_C06_017`
- `CG_C06_018`

</details>

### Arc 1 - Ch.7（22）

<details><summary>22 张未包含图片文件</summary>

- `CG_C07_001`
- `CG_C07_002`
- `CG_C07_003`
- `CG_C07_004`
- `CG_C07_005`
- `CG_C07_006`
- `CG_C07_007`
- `CG_C07_008`
- `CG_C07_009`
- `CG_C07_010`
- `CG_C07_011`
- `CG_C07_012`
- `CG_C07_013`
- `CG_C07_014`
- `CG_C07_015`
- `CG_C07_016`
- `CG_C07_017`
- `CG_C07_018`
- `CG_C07_019`
- `CG_C07_020`
- `CG_C07_021`
- `CG_C07_022`

</details>

### Arc 1 - Ch.8 (终章)（12）

<details><summary>12 张未包含图片文件</summary>

- `CG_C08_001`
- `CG_C08_002`
- `CG_C08_003`
- `CG_C08_004`
- `CG_C08_005`
- `CG_C08_006`
- `CG_C08_007`
- `CG_C08_008`
- `CG_C08_009`
- `CG_C08_010`
- `CG_C08_011`
- `CG_C08_012`

</details>

### Arc 1 - Interlude (幕间)（23）

<details><summary>23 张未包含图片文件</summary>

- `CG_C09_001`
- `CG_C09_002`
- `CG_C09_003`
- `CG_C09_004_1_F`
- `CG_C09_004_1_M`
- `CG_C09_004_F`
- `CG_C09_004_M`
- `CG_C09_005_F`
- `CG_C09_005_M`
- `CG_C09_006_F`
- `CG_C09_006_M`
- `CG_C09_007`
- `CG_C09_008`
- `CG_C09_009`
- `CG_C09_010`
- `CG_C09_011_F`
- `CG_C09_011_M`
- `CG_C09_012`
- `CG_C09_013`
- `CG_C09_014`
- `CG_C09_015`
- `CG_C09_016`
- `CG_C09_017`

</details>

### Arc 2 - Prologue (序章)（10）

<details><summary>10 张未包含图片文件</summary>

- `CG_C201_001`
- `CG_C201_002`
- `CG_C201_003`
- `CG_C201_004`
- `CG_C201_005`
- `CG_C201_006`
- `CG_C201_007`
- `CG_C201_008`
- `CG_C201_009`
- `CG_C201_010`

</details>

### Arc 2 - Ch.1（15）

<details><summary>15 张未包含图片文件</summary>

- `CG_C202_001`
- `CG_C202_002`
- `CG_C202_003`
- `CG_C202_004`
- `CG_C202_005`
- `CG_C202_006`
- `CG_C202_007`
- `CG_C202_008`
- `CG_C202_009`
- `CG_C202_010`
- `CG_C202_011`
- `CG_C202_012`
- `CG_C202_013`
- `CG_C202_014`
- `CG_C202_015`

</details>

### Arc 2 - Ch.2（10）

<details><summary>10 张未包含图片文件</summary>

- `CG_C203_001`
- `CG_C203_002`
- `CG_C203_003`
- `CG_C203_004`
- `CG_C203_005`
- `CG_C203_006`
- `CG_C203_007`
- `CG_C203_008`
- `CG_C203_009`
- `CG_C203_010`

</details>

### Arc 2 - Ch.3（12）

<details><summary>12 张未包含图片文件</summary>

- `CG_C204_001`
- `CG_C204_002`
- `CG_C204_003`
- `CG_C204_004`
- `CG_C204_005`
- `CG_C204_006`
- `CG_C204_007`
- `CG_C204_008`
- `CG_C204_009`
- `CG_C204_010`
- `CG_C204_011`
- `CG_C204_012`

</details>

### Arc 2 - Ch.4（7）

<details><summary>7 张未包含图片文件</summary>

- `CG_C205_001`
- `CG_C205_002`
- `CG_C205_003`
- `CG_C205_004`
- `CG_C205_005`
- `CG_C205_006`
- `CG_C205_007`

</details>

## 特殊 CG

### Collection CG (收藏CG)（12）

<details><summary>12 张未包含图片文件</summary>

- `CG_Coll_Entry_01`
- `CG_Coll_Entry_02`
- `CG_Coll_Entry_03`
- `CG_Coll_Entry_04`
- `CG_Coll_Entry_05`
- `CG_Coll_Entry_06`
- `CG_Coll_Entry_07`
- `CG_Coll_Entry_08`
- `CG_Coll_Entry_09`
- `CG_Coll_Entry_10`
- `CG_Coll_Entry_11`
- `CG_Coll_Entry_12`

</details>

### SD / Chibi CG (Q版CG)（185）

<details><summary>185 张未包含图片文件</summary>

- `CG_SD_L_B02_1`
- `CG_SD_L_B02_2`
- `CG_SD_L_B02_3`
- `CG_SD_L_B02_4`
- `CG_SD_L_B02_6`
- `CG_SD_L_B02_6_A`
- `CG_SD_L_B02_7_A`
- `CG_SD_L_B02_7_B`
- `CG_SD_L_B02_7_C`
- `CG_SD_L_B02_8`
- `CG_SD_L_B04_1`
- `CG_SD_L_B04_2`
- `CG_SD_L_B04_3`
- `CG_SD_L_B04_4`
- `CG_SD_L_B05EX_1`
- `CG_SD_L_B05EX_2`
- `CG_SD_L_B05EX_3`
- `CG_SD_L_B05EX_4`
- `CG_SD_L_B05EX_5`
- `CG_SD_L_B05EX_6`
- `CG_SD_L_B05EX_7`
- `CG_SD_L_B05EX_8`
- `CG_SD_L_C10_1`
- `CG_SD_L_C10_2`
- `CG_SD_L_C10_3`
- `CG_SD_L_C10_4`
- `CG_SD_L_C10_5`
- `CG_SD_L_C10_6`
- `CG_SD_L_C10_7`
- `CG_SD_L_D02_1`
- `CG_SD_L_D02_2`
- `CG_SD_L_D02_3`
- `CG_SD_L_D02_4`
- `CG_SD_L_D06_1`
- `CG_SD_L_D06_10`
- `CG_SD_L_D06_11`
- `CG_SD_L_D06_12`
- `CG_SD_L_D06_13`
- `CG_SD_L_D06_14`
- `CG_SD_L_D06_15`
- `CG_SD_L_D06_16`
- `CG_SD_L_D06_17`
- `CG_SD_L_D06_18`
- `CG_SD_L_D06_2`
- `CG_SD_L_D06_3`
- `CG_SD_L_D06_3-2`
- `CG_SD_L_D06_3-3`
- `CG_SD_L_D06_4`
- `CG_SD_L_D06_4-1`
- `CG_SD_L_D06_5`
- `CG_SD_L_D06_5-1`
- `CG_SD_L_D06_6`
- `CG_SD_L_D06_7-1`
- `CG_SD_L_D06_7-2`
- `CG_SD_L_D06_7-3`
- `CG_SD_L_D06_7-4`
- `CG_SD_L_D06_7-5`
- `CG_SD_L_D06_8`
- `CG_SD_L_D06_9`
- `CG_SD_L_D11_1`
- `CG_SD_L_D14_1`
- `CG_SD_L_FarewellNeverland_1`
- `CG_SD_L_FarewellNeverland_2`
- `CG_SD_L_FarewellNeverland_3`
- `CG_SD_L_O07_1`
- `CG_SD_L_O07_10`
- `CG_SD_L_O07_11`
- `CG_SD_L_O07_12`
- `CG_SD_L_O07_2`
- `CG_SD_L_O07_3`
- `CG_SD_L_O07_4`
- `CG_SD_L_O07_5`
- `CG_SD_L_O07_6`
- `CG_SD_L_O07_7`
- `CG_SD_L_O07_8`
- `CG_SD_L_O07_9`
- `CG_SD_L_O10_1`
- `CG_SD_L_O10_2`
- `CG_SD_L_O10_3`
- `CG_SD_L_SF1_01`
- `CG_SD_L_SF1_02`
- `CG_SD_L_SF1_03`
- `CG_SD_MyTurn_01`
- `CG_SD_S_B06_1`
- `CG_SD_S_B06_2`
- `CG_SD_S_B07_1`
- `CG_SD_S_B07_2`
- `CG_SD_S_B07_3`
- `CG_SD_S_B07_4`
- `CG_SD_S_B12_1`
- `CG_SD_S_B14_1`
- `CG_SD_S_B14_2`
- `CG_SD_S_B14_3`
- `CG_SD_S_B14_4`
- `CG_SD_S_C01EX_1`
- `CG_SD_S_C01EX_10`
- `CG_SD_S_C01EX_11`
- `CG_SD_S_C01EX_12`
- `CG_SD_S_C01EX_13`
- `CG_SD_S_C01EX_14`
- `CG_SD_S_C01EX_14_1`
- `CG_SD_S_C01EX_14_2`
- `CG_SD_S_C01EX_2`
- `CG_SD_S_C01EX_3`
- `CG_SD_S_C01EX_4`
- `CG_SD_S_C01EX_5`
- `CG_SD_S_C01EX_6`
- `CG_SD_S_C01EX_7`
- `CG_SD_S_C01EX_8`
- `CG_SD_S_C01EX_9`
- `CG_SD_S_C02EX_1`
- `CG_SD_S_C02EX_10`
- `CG_SD_S_C02EX_7`
- `CG_SD_S_C02EX_8`
- `CG_SD_S_C02EX_9`
- `CG_SD_S_C03_1`
- `CG_SD_S_C03_2`
- `CG_SD_S_C05_1`
- `CG_SD_S_C05_2`
- `CG_SD_S_C05_3`
- `CG_SD_S_C05_4`
- `CG_SD_S_C05_5`
- `CG_SD_S_C05_6`
- `CG_SD_S_C05_7`
- `CG_SD_S_C05_8`
- `CG_SD_S_C05_9`
- `CG_SD_S_C06_1`
- `CG_SD_S_C06_10`
- `CG_SD_S_C06_11`
- `CG_SD_S_C06_14`
- `CG_SD_S_C06_15`
- `CG_SD_S_C06_16`
- `CG_SD_S_C06_17`
- `CG_SD_S_C06_2`
- `CG_SD_S_C06_3`
- `CG_SD_S_C06_4`
- `CG_SD_S_C06_5`
- `CG_SD_S_C06_6`
- `CG_SD_S_C06_7`
- `CG_SD_S_C06_8`
- `CG_SD_S_C06_9`
- `CG_SD_S_C16_1`
- `CG_SD_S_C16_2`
- `CG_SD_S_C17_01`
- `CG_SD_S_C17_01_2`
- `CG_SD_S_C17_01_3`
- `CG_SD_S_C17_02`
- `CG_SD_S_C17_02_2`
- `CG_SD_S_D01_1`
- `CG_SD_S_D04_1`
- `CG_SD_S_D04_2`
- `CG_SD_S_D04_3`
- `CG_SD_S_D04_4`
- `CG_SD_S_D08_1`
- `CG_SD_S_D08_2`
- `CG_SD_S_D08_3`
- `CG_SD_S_D08_4`
- `CG_SD_S_D08_5`
- `CG_SD_S_D14_1`
- `CG_SD_S_Fool`
- `CG_SD_S_O01_1`
- `CG_SD_S_O01_2`
- `CG_SD_S_O01_3`
- `CG_SD_S_O01_4`
- `CG_SD_S_O01_5`
- `CG_SD_S_O01_6`
- `CG_SD_S_O05_1`
- `CG_SD_S_O05_2`
- `CG_SD_S_O06_1`
- `CG_SD_S_O06_2`
- `CG_SD_S_O06_3`
- `CG_SD_S_O06_4`
- `CG_SD_S_O06_6`
- `CG_SD_S_O06_7`
- `CG_SD_S_O06_8`
- `CG_SD_S_O06_9`
- `CG_SD_S_O08_1`
- `CG_SD_S_O08_2`
- `CG_SD_S_O11_01`
- `CG_SD_S_O11_02`
- `CG_SD_S_WB2_1`
- `CG_SD_S_WB2_1_2`
- `CG_SD_S_WB2_2`
- `CG_SD_S_WB2_2_2`
- `CG_SD_S_WB2_3`

</details>
