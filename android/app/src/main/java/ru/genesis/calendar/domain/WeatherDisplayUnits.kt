package ru.genesis.calendar.domain

enum class WeatherTemperatureUnit(val wire: String) {
    CELSIUS("celsius"), FAHRENHEIT("fahrenheit");
    companion object { fun fromWire(value: String) = entries.firstOrNull { it.wire == value } ?: CELSIUS }
}

enum class WeatherPressureUnit(val wire: String) {
    HPA("hpa"), MMHG("mmhg");
    companion object { fun fromWire(value: String) = entries.firstOrNull { it.wire == value } ?: HPA }
}

data class WeatherDisplayUnits(val temperature: WeatherTemperatureUnit = WeatherTemperatureUnit.CELSIUS,
    val pressure: WeatherPressureUnit = WeatherPressureUnit.HPA)

/** Provider data and weather effects always retain canonical Celsius/hPa values. */
fun weatherTemperature(value: Double?, unit: WeatherTemperatureUnit): Double? = value?.takeIf { it.isFinite() }?.let {
    if (unit == WeatherTemperatureUnit.FAHRENHEIT) it * 9 / 5 + 32 else it
}
fun weatherPressure(value: Double?, unit: WeatherPressureUnit): Double? = value?.takeIf { it.isFinite() }?.let {
    if (unit == WeatherPressureUnit.MMHG) it * 0.750061683 else it
}
