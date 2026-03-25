# エクスポート関連メモ

## 暗号化
https://docs.godotengine.org/ja/4.x/tutorials/export/exporting_projects.html

- `.`ではじまるファイルやフォルダーはエクスポートしない
- エクスポートするシーンを選択したい
- `.txt`, `.json`, `.csv`などをエクスポートに含めるためのフィルター
- `.png`などの主要な拡張子のリソースを除外するフィルター
- `export_presents.cfg`にはgitに登録してよい安全な設定が保存される
- `.godot/export_credentials.cfg`にはバージョン管理に含めたくないパスワードや暗号化キーなどの保存に使う

### PCKかZIPか

- PCK
  - 非圧縮。サイズは大きいが読み書きが速い
  - OSから原則として読み取れない
  - 暗号化が可能
- zip
  - 圧縮。サイズは小さく読み書きは遅い
  - OSからの読み書きが可能
  - MODの作成など

### 暗号化の設定

- PCKにはGDScriptなどがそのまま含まれる
- PCKを暗号化できる
- エクスポートを開いて暗号化タブを選択
  - ファイル名を暗号化
  - フィルタは必要であったり不要な素材の選択
- 16進数で256ビットの暗号キーを設定。32文字
  - リソースに含める必要あり
- コンパイルが必要
  
### 暗号化

[Compiling with PCK encryption key](https://docs.godotengine.org/en/4.2/contributing/development/compiling/compiling_with_script_encryption_key.html)

以下、前提。

- PCK encryptionを使ったテンプレートをソースからビルドする
- AndroidではAPK extentionオプションを使用する

手順。

16進数フォーマットの256bitのAESキーを生成します。

- PowerShellなどを起動します
- 以下を実行します

```
openssl rand -hex 32 > .godot.gdkey
```

- .godot.gdkeyをgit管理から外します
- godotをコンパイルするコンソールやターミナルで環境設定をします

```
// Linux/macOS
export SCRIPT_AES256_ENCRYPTION_KEY="your_generated_key"

// Windows(cmd)
set SCRIPT_AES256_ENCRYPTION_KEY=your_generated_key

// Windows(PowerShell)
$env:SCRIPT_AES256_ENCRYPTION_KEY="your_generated_key"
```

- GodotのExport Templateをコンパイルします
- エクスポートしたテンプレートをエクスポート設定のオプションで設定します
- エクスポート設定の暗号化タブのEncryption Keyに生成したAESキーを設定します

以上でエクスポートします。

### トラブルシューティング

以下のようなエラーが発生したら、キーがGodotビルドに含まれていないということです。

```
ERROR: open_and_parse: Condition "String::md5(md5.digest) != String::md5(md5d)" is true. Returning: ERR_FILE_CORRUPT
   At: core/io/file_access_encrypted.cpp:103
```

> テンプレートのAESキービルドの失敗かテンプレートの選択ミス？


