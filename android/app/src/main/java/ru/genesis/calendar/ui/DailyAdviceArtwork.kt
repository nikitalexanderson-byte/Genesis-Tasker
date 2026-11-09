package ru.genesis.calendar.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File

/** Public illustrations only. Keep a bounded private cache across rotations and theme changes. */
internal object DailyAdviceArtwork {
    private const val budget = 8L * 1024 * 1024
    @Synchronized fun load(context: Context, path: String): Bitmap? {
        require(Regex("/advice-art/[a-z0-9-]+/advice-[a-f0-9]{24}\\.webp").matches(path))
        val directory = File(context.cacheDir, "daily-advice-art")
        val cached = File(directory, path.substringAfterLast('/').removeSuffix(".webp") + ".png")
        if (cached.length() in 1..budget) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(cached.path, bounds)
            if (bounds.outWidth in 1..1200 && bounds.outHeight in 1..1200) {
                BitmapFactory.decodeFile(cached.path)?.let { cached.setLastModified(System.currentTimeMillis()); return it }
            }
        }
        val bitmap = genesisImageBitmap("https://genesiscalendar.com" + path) ?: return null
        runCatching {
            check(directory.isDirectory || directory.mkdirs())
            val pending = File(directory, cached.name + ".pending")
            try {
                pending.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
                if (pending.length() in 1..budget) {
                    check(pending.renameTo(cached))
                    var total = directory.listFiles()?.sumOf { it.length() } ?: 0L
                    directory.listFiles()?.filter { it != cached }?.sortedBy { it.lastModified() }?.forEach {
                        if (total > budget) { val size = it.length(); if (it.delete()) total -= size }
                    }
                }
            } finally { pending.delete() }
        }
        return bitmap
    }
}
