# LiteRT-LM (D-032) ships no consumer R8 rules; its JNI code looks up Kotlin
# classes (messages, callbacks, exceptions) by name, so keep the package.
-keep class com.google.ai.edge.litertlm.** { *; }
-dontwarn com.google.ai.edge.litertlm.**
