C:\Users\<ユーザーフォルダー>\AppData\Roaming\Godotフォルダー内のeditor_settings-4.tresのような名前のファイルに、テキストで保存されています。
[resource]とある行の下に、`interface/editor/`という設定が並んでいます。そこに設定を追加して、Godotを再起動すれば、スクリプトなしでもカスタムスケールを設定できます。

interface/editor/display_scaleの設定を探して、設定を7にします。

```
interface/editor/display_scale = 7
```

80%にしたい場合は、次のように設定します。

```
interface/editor/custom_display_scale = 0.8
```

反映させるには、Godotの再起動が必要です。




