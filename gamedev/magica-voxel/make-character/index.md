
---
published: false
---

# MagicaVoxelでボクセルのキャラクターを作る

Godot EngineやUnityで使えるボクセルキャラクターの作り方です。MagicaVoxelで、キャラをモデリングします。作ったモデルをBlenderに読み込んで、ボーン入れやアニメーションを付けます。

https://ephtracy.github.io/

基本機能について、まずはこの動画を見てください。

https://www.youtube.com/watch?v=WPPFnHQWwFk

## 中心へ移動

キャラができたら、オブジェクトを原点付近に移動させます。

- Tabキーを押して、オブジェクトモードを切り替える
- 矢印をドラッグして、原点近くへ移動させる

ボクセルサイズが奇数の場合、中心は設定できないので、1つずらしておく。


## Blenderにvoxのインポート

### 公式アドオン

- https://github.com/AstrorEnales/blender_magicavoxel
  - 複数のメッシュ、色、マテリアルの読み込み、ボクセルサイズの調整機能
  - Blender4.2LTS以降
  - MITライセンス
  - https://extensions.blender.org/add-ons/blender-magicavoxel/ を開く
  - ページ下のGet Add-onをクリック
  - Blenderを開いて、Drag and Drop into Blenderをドラッグして、Blenderにドロップする
  - Install Extensionのダイアログが表示されたら、オンラインアクセスを許可をクリックする
  - エクステンションを入手をクリックして、オンラインアクセスを許可をクリックして、プリファレンスダイアログを閉じる
  - あらためて、Drag and Drop iinto BlenderをBlenderへドロップする
  - Enable Add-onにチェックが入ったまま、OKをクリックする

以上で、ファイルメニューのインポートに、MagicaVoxel(.vox)メニューが追加されます。


### voxファイルを読み込む

- ファイルメニューのインポートから、MagicaVoxel(.vox)を選択する
- voxファイルを読み込む

以上で読み込めます。


### GitHubにあったやつ
- https://github.com/RichysHub/MagicaVoxel-VOX-importer
  - MITライセンス
  - https://github.com/RichysHub/MagicaVoxel-VOX-importer を開く
  - io_scene_vox.pyをクリックして、任意のフォルダーへダウンロードする
  - Blenderのアドオンフォルダーを開く。
     

### 中央に移動

オブジェクトを、ワールドの中心に移動させる。

MagicaVoxelのボクセルの大きさは、0.1mです。0.05m移動させて、中心にします。

- オブジェクトモードに切り替える
- 読み込んだオブジェクトをクリックして選択する
- Tabキーを押すなどして、編集モードにする
- Aキーですべて選択
- テンキーの1を押して、正面モードにする
- Gキーで移動モードにして、Xキーを押してから、中心になるように移動

### 面を最適化

以下、不要な可能性が高い。チェックして、不要なら消す。

- 編集モードで、すべて選択
- 面 > 面を最適化を選ぶ
- 辺を細分化を選んで、関節に必要な頂点を選ぶ
- 面 > 面を最適化を選ぶ

## ボーンとウェイトの設定

https://mesh2motion.org/ を試す。

- mixamoと同じように、テンプレートとなるボーンを、モデルに合わせる
- 人型なら十分に使えそう
- 使えるモーションを調べる
