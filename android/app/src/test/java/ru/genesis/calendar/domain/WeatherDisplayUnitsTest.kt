package ru.genesis.calendar.domain

import org.junit.Assert.*
import org.junit.Test

class WeatherDisplayUnitsTest {
    @Test fun celsiusAndFahrenheitAgreeAtKnownReferencePoints() {
        for ((c, f) in listOf(0.0 to 32.0, 100.0 to 212.0, -40.0 to -40.0, 6.2 to 43.16)) {
            assertEquals(c, weatherTemperature(c, WeatherTemperatureUnit.CELSIUS)!!, 1e-9)
            assertEquals(f, weatherTemperature(c, WeatherTemperatureUnit.FAHRENHEIT)!!, 1e-9)
        }
    }
    @Test fun standardPressureConvertsWithoutChangingProviderUnits() {
        assertEquals(760.0, weatherPressure(1013.25, WeatherPressureUnit.MMHG)!!, .001)
        assertEquals(1013.25, weatherPressure(1013.25, WeatherPressureUnit.HPA)!!, 1e-9)
        assertEquals(0.0, weatherPressure(0.0, WeatherPressureUnit.MMHG)!!, 0.0)
    }
    @Test fun unknownAndNonFiniteValuesStayUnknown() {
        for (value in listOf(null, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
            assertNull(weatherTemperature(value, WeatherTemperatureUnit.FAHRENHEIT))
            assertNull(weatherPressure(value, WeatherPressureUnit.MMHG))
        }
    }
    @Test fun invalidPreferencesFallBackToTheExistingUnits() {
        assertEquals(WeatherTemperatureUnit.CELSIUS, WeatherTemperatureUnit.fromWire("kelvin"))
        assertEquals(WeatherPressureUnit.HPA, WeatherPressureUnit.fromWire("psi"))
        assertEquals(WeatherTemperatureUnit.FAHRENHEIT, WeatherTemperatureUnit.fromWire("fahrenheit"))
        assertEquals(WeatherPressureUnit.MMHG, WeatherPressureUnit.fromWire("mmhg"))
    }
}
