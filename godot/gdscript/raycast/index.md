
---
layout: godot
category: gdscript
tags: ["キャラ制御","RayCast","Godot4.2"]
date: 2024-01-16 11:00:00 +0900
title: 【Godot】RayCastの利用
sub_title: 例えば「移動先に段があったら自動的にジャンプさせたい」というようなかしこい操作を実装するには周囲の情報が必要です。これをやるRayCastの機能を紹介します。
toc: true
---

# やりたいこと
移動先を確認

# 手法を調べる
公式マニュアルで[レイキャスティング](https://docs.godotengine.org/ja/4.x/tutorials/physics/ray-casting.html)を確認します。


リファレンスで機能を調べます。

2Dなら[PhysicsDirectSpaceState2D](https://docs.godotengine.org/ja/4.x/classes/class_physicsdirectspacestate2d.html#class-physicsdirectspacestate2d)、3Dなら[PhysicsDirectSpaceState3D](https://docs.godotengine.org/ja/4.x/classes/class_physicsdirectspacestate3d.html#class-physicsdirectspacestate3d)が機能を持っています。

## メソッドの紹介
- cast_motion()
  - 形状と移動ベクトルを指定して、衝突する距離を返す
- collide_shape()
  - 

デモでcollide_shapeのみ発見。


## 使い方

```python
	var shape = _collision_shapes[_collision_test_index]
	var shape_query = PhysicsShapeQueryParameters2D.new()
	shape_query.set_shape(shape)
```


# 参考URL
- [公式マニュアル. レイキャスティング](https://docs.godotengine.org/ja/4.x/tutorials/physics/ray-casting.html)
- [公式リファレンス. PhysicsDirectSpaceState2D](https://docs.godotengine.org/ja/4.x/classes/class_physicsdirectspacestate2d.html#class-physicsdirectspacestate2d)
- [公式リファレンス. PhysicsDirectSpaceState3D](https://docs.godotengine.org/ja/4.x/classes/class_physicsdirectspacestate3d.html#class-physicsdirectspacestate3d)
- [godot-demo-projects](https://github.com/godotengine/godot-demo-projects)
