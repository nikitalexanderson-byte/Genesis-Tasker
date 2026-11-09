package ru.genesis.calendar.ui

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import java.util.concurrent.ConcurrentHashMap

/** Keep source files intact; decode only the pixels needed by the current image slot. */
internal object OriginalImageLoader {
    private val dimensions = ConcurrentHashMap<String, Pair<Int, Int>>()
    private val bitmaps = object : LruCache<String, Bitmap>(32 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.allocationByteCount
    }

    fun cached(path: String, width: Int, height: Int): Bitmap? {
        val assetPath = "originals/$path"
        val bounds = dimensions[assetPath] ?: return null
        return bitmaps.get("$assetPath@${imageSampleSize(bounds.first, bounds.second, width, height)}")
    }

    fun load(assets: AssetManager, path: String, width: Int, height: Int): Bitmap? {
        if (width <= 0 || height <= 0) return null
        val assetPath = "originals/$path"
        val bounds = dimensions[assetPath] ?: run {
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            assets.open(assetPath).use { BitmapFactory.decodeStream(it, null, options) }
            if (options.outWidth <= 0 || options.outHeight <= 0) return null
            (options.outWidth to options.outHeight).also { dimensions.putIfAbsent(assetPath, it) }
        }
        val sample = imageSampleSize(bounds.first, bounds.second, width, height)
        val key = "$assetPath@$sample"
        bitmaps.get(key)?.let { return it }
        val decoded = assets.open(assetPath).use { stream ->
            BitmapFactory.decodeStream(stream, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        bitmaps.put(key, decoded)
        return decoded
    }
}

internal fun imageSampleSize(sourceWidth: Int, sourceHeight: Int, targetWidth: Int, targetHeight: Int): Int {
    if (targetWidth <= 0 || targetHeight <= 0) return 1
    var sample = 1
    while (sample <= 1 shl 28 && sourceWidth / (sample * 2) >= targetWidth &&
        sourceHeight / (sample * 2) >= targetHeight) sample *= 2
    return sample
}
