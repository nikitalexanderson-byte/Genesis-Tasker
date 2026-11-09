package ru.genesis.calendar.domain

/** Port of the site's seeded Stoicheion shuffle, orientation and isopsephy rules. */
object StoicheionReading {
    private class Randomizer(seed: Int) {
        private var state = seed
        fun next(): Double {
            state += 0x6d2b79f5
            var mixed = state
            mixed = (mixed xor (mixed ushr 15)) * (mixed or 1)
            mixed = mixed xor (mixed + ((mixed xor (mixed ushr 7)) * (mixed or 61)))
            return (mixed xor (mixed ushr 14)).toUInt().toLong().toDouble() / 4_294_967_296.0
        }
    }

    fun <T> cardOfDay(cards: List<T>, seed: Long): T? =
        if (cards.isEmpty()) null else cards[(seed and 0xffff_ffffL).rem(cards.size).toInt()]

    fun <T> spread(cards: List<T>, seed: Long, size: Int = 9): List<Pair<T, Boolean>> {
        val pool = cards.toMutableList()
        val random = Randomizer(seed.toInt() xor 0xa511e9b3.toInt())
        for (index in pool.lastIndex downTo 1) {
            val swap = (random.next() * (index + 1)).toInt()
            val previous = pool[index]
            pool[index] = pool[swap]
            pool[swap] = previous
        }
        return pool.take(size.coerceAtLeast(0)).mapIndexed { index, card ->
            card to reversed(seed, index + 1)
        }
    }

    fun reversed(seed: Long, position: Int = 0): Boolean =
        Randomizer(seed.toInt() xor ((position + 1) * 0x27d4eb2d)).next() < .5

    fun pythmen(total: Int): Int = if (total == 0) 0 else 1 + (total - 1) % 9

    fun trace(total: Int): List<Int> {
        val values = mutableListOf(total)
        while (values.last() > 9) values += values.last().toString().sumOf { it.digitToInt() }
        return values
    }

    fun mix(seed: Long, xPercent: Float, yPercent: Float, time: Long): Long {
        val x = kotlin.math.floor(xPercent * 100 + .5f).toInt()
        val y = kotlin.math.floor(yPercent * 100 + .5f).toInt()
        var value = seed.toInt() xor (x * 0x45d9f3b) xor (y * 0x119de1f3) xor time.toInt()
        value = (value xor (value ushr 16)) * 0x45d9f3b
        return (value xor (value ushr 16)).toUInt().toLong()
    }
}
