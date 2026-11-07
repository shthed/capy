package com.capypaint.capy

import com.capypaint.capy.util.CapyLogger
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CapyLoggerTest {

    @Before
    fun setUp() {
        CapyLogger.clearLogs()
        CapyLogger.isDebug = true
    }

    @Test
    fun testDebugLoggingWhenDebugEnabled() {
        CapyLogger.isDebug = true
        CapyLogger.d("TestTag", "Debug log message 123")

        val history = CapyLogger.getLogHistoryFormatted()
        assertTrue(history.contains("[D] [TestTag]"))
        assertTrue(history.contains("Debug log message 123"))
    }

    @Test
    fun testDebugLoggingSuppressedWhenDebugDisabled() {
        CapyLogger.isDebug = false
        CapyLogger.d("TestTag", "Should NOT be logged")
        CapyLogger.v("TestTag", "Verbose NOT logged")
        CapyLogger.i("TestTag", "Info SHOULD be logged")

        val history = CapyLogger.getLogHistoryFormatted()
        assertFalse(history.contains("Should NOT be logged"))
        assertFalse(history.contains("Verbose NOT logged"))
        assertTrue(history.contains("Info SHOULD be logged"))
    }

    @Test
    fun testInfoWarnErrorLoggedRegardlessOfDebugMode() {
        CapyLogger.isDebug = false
        CapyLogger.i("TestTag", "Info log msg")
        CapyLogger.w("TestTag", "Warn log msg")
        CapyLogger.e("TestTag", "Error log msg")

        val history = CapyLogger.getLogHistoryFormatted()
        assertTrue(history.contains("[I] [TestTag]"))
        assertTrue(history.contains("Info log msg"))
        assertTrue(history.contains("[W] [TestTag]"))
        assertTrue(history.contains("Warn log msg"))
        assertTrue(history.contains("[E] [TestTag]"))
        assertTrue(history.contains("Error log msg"))
    }

    @Test
    fun testClearLogs() {
        CapyLogger.i("TestTag", "Some log entry")
        assertTrue(CapyLogger.getLogHistoryFormatted().contains("Some log entry"))

        CapyLogger.clearLogs()
        assertFalse(CapyLogger.getLogHistoryFormatted().contains("Some log entry"))
    }
}
