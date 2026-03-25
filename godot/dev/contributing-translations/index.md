
1. Godotエディターのインターフェース
2. マニュアルやチュートリアルなどのオンラインドキュメント
3. クラスリファレンス

POファイルと[Weblate](https://weblate.org/ja/)を利用

ちなみに、翻訳の優先度はエディターインターフェース、オンラインドキュメント、更新に追いつけるならクラスリファレンスの順。

[Weblateへ登録](https://hosted.weblate.org/accounts/register/)したら、貢献したいGodotのリソースをブラウザーで開く。エディターの翻訳は[こちら](https://hosted.weblate.org/projects/godot-engine/godot/)。

- githubで登録済み


## 変更点
- エディターの翻訳時
  - %sや%dは実行時に翻訳内容に置き換えられるので、POではダブルクォーテーションでくくる。またシングルクオーテーションで%sなどをくくる
  - エスケープ文字
    - Weblateでは\nや\tはそれぞれ文字に置き換わる。
- オンラインドキュメント(RST:reStructuredText)
  - **で太字
  - リンク `Have a look here <https://docs.godotengine.org/en/latest>`_ の場合、`Have a look here`だけを翻訳。リンク先は翻訳している言語のものにしてよい
  - |で囲むと画像へのインラインリンク。そのままにする
  - ``で囲むとインラインコード。`だとリンクになるので注意
  - :ref:`file` で、fileへの他のページへの内部リンク。ページ名のみ指定できる。表示は自動的にリンク先のタイトルに置き換わる
  - :ref:`how to contribute <doc_ways_to_contribute>`とすると、タイトルの置き換えができる
  - :kbd:などはショートカットキー。``内を英語と違う表現なら変更する
  - 詳しくは[こちら](https://www.sphinx-doc.org/en/master/usage/restructuredtext/basics.html)
- クラスリファレンス
  - GodotのリポジトリでXML形式で作成
- ::の前にスペースは不要。日本語の場合、コマンドとの間にスペースが必要

## オフラインでの翻訳とテスト

https://docs.godotengine.org/ja/4.x/contributing/documentation/editor_and_docs_localization.html#offline-translation-and-testing

- [Poedit](https://poedit.net/)や[Lokalize](https://userbase.kde.org/Lokalize)が使える
  - Poeditをインストール。スタートメニューから開ける

- Weblateで対象のページを開く
- FilesメニューからDownload original translation fileを選択
- 一度ダウンロードすると、更新したファイルをアップロードするメニューが表示される。ただし、オフラインだと最新の情報から遅れるのでオンラインで作業することを推奨
- エディターの場合はGodotエディターをソースからコンパイルする
  - ダウンロードしたpoファイルを`ja.po`のように言語名に変更して、editor/translationis/フォルダーに配置する
  - クラスリファレンスも同様にリネームして、doc/translationsに配置する

## 画像のローカライズ
- [godot-docs-l10n](https://github.com/godotengine/godot-docs-l10n)リポジトリーにアップロードすると、Weblateと連携する
- 英語のドキュメントの場所を開く。たとえば[はじめてのGodotエディタ](https://docs.godotengine.org/ja/4.x/getting_started/introduction/first_look_at_the_editor.html#doc-intro-to-the-editor-interface)等のページ。右上のEdit on GitHubリンクをクリックする
- GitHub上で変更したい画像をクリックする。画像へのフルパスが必要。
- ローカライズした画像を作成したら、元の画像ファイル名の拡張子の前に言語の指定を入れる
- godot-docs-l10n上でimagesサブフォルダー内にオリジナルと同じフォルダー構造を作って、そこにローカライズした画像を置く
  - 例 images/getting_started/step_by_step/img/project_manager_first_open.fr.png
- すべての画像ができたら[プルリクエスト](https://docs.godotengine.org/ja/4.x/contributing/workflow/pr_workflow.html#doc-pr-workflow)を送る



## poに保存されているreStructuredTextをレンダリングしたい

https://qiita.com/kazetof/items/d410dae312d56b7324c0

poは翻訳用のファイルで、Poeditで見れるのはマークダウンテキストで、これが正しく描画できるかの確認はできない。それをやるにはreStructuredTextをpdfやhtmlに変換する必要がありそう。

Sphinxが変換用のツール。

Visual Studio Codeにプレビュー機能がある拡張があるのでそれを入れればよさそう。

LeXtudio Inc.のreStructuredTextが人気

reStructurdTextはエラーになる。本家のSphynxを使った方がよさげ。





## 公式マニュアルのチュートリアルの確認

### en
- [ラベルを作る](https://docs.godotengine.org/en/stable/getting_started/step_by_step/index.html)
  - ok
  - 英語になっているところやリンクが外れているところがあるので修正が必要
- [Creating instances](https://docs.godotengine.org/en/stable/getting_started/step_by_step/instancing.html)


## リンクについて

最後に`_`とするか`__`にするかで意味が違うらしい。

https://nikkie-ftnext.hatenablog.com/entry/restructuredtext-various-hyperlink-markup

#### 用語チェック
- ダイアログ
- ウィンドウの下で
- 2Dワークスペース
- ビューポート。中心の場所
- シーンドック
- インスペクタードック
- textプロパティ
- Playシーンボタン(現在のシーンを実行)
- 保存したシーンをPackedSceneと呼ぶ


# 参考URL
- [公式ドキュメント. Editor and documentation localization](https://docs.godotengine.org/ja/4.x/contributing/documentation/editor_and_docs_localization.html#doc-editor-and-docs-localization)
- [Weblate](https://weblate.org/ja/)
- [reStructuredText入門](https://www.sphinx-doc.org/ja/master/usage/restructuredtext/basics.html)
- [Sphinxのインストール](https://www.sphinx-doc.org/ja/master/usage/installation.html)
- [Sphinx + VSCodeでプレビューを見たい！](https://qiita.com/1taroh/items/044f3cd58a7e39b85379)
  - これが必要そう [restructuredtext. Configuration](https://docs.restructuredtext.net/articles/configuration)
  - ライブプレビューに https://docs.esbon.io/en/latest/ を使っている
  - docutilのインストールに失敗していた。pip install docutilsは失敗。conda install docutilsでインストール
  - 右下でesbonioは動いているがSphinx[undefined]になる

## reStructuredTextのVSCodeでの使い方

- VSCodeを起動
- reStructuredTextとExtensionをインストール
- 右下に表示される推奨拡張を全てインストール
- VSCodeを閉じる
- ターミナルを起動して、プロジェクトをsphinx-quickstartで作成
- spinx-quickstartで作成したフォルダーをVSCodeで開く
- エラーが出て上に何か表示されたら、示されるコンフィグファイルを選択する
- プレビューボタンを押す




